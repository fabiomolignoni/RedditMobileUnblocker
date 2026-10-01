import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const popupScript = read("../extension/popup/popup.js");
const popupHtml = read("../extension/popup/index.html");
const statusScript = read("../extension/content/status.js");
const backgroundScript = read("../extension/background.js");
const unblockScript = read("../extension/content/unblock.js");
const unblockCss = read("../extension/content/unblock.css");
const locales = Object.fromEntries(["en", "it"].map(language => [
  language, JSON.parse(read(`../extension/_locales/${language}/messages.json`)),
]));

function fakeNode(dataset = {}) {
  return { textContent: "", dataset, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
}

async function renderPopup(total, response, { reject = false, storageError = false, language = "en" } = {}) {
  const elements = new Map(["version", "status", "status-title", "status-detail", "total", "total-label"]
    .map(id => [id, fakeNode()]));
  const translated = [fakeNode({ i18n: "sourceCode" }), fakeNode({ i18n: "versionLabel" })];
  const labelled = [fakeNode({ i18nLabel: "projectLinks" })];
  const documentElement = { lang: "" };
  let changed;
  const browser = {
    i18n: {
      getUILanguage: () => language,
      getMessage: name => locales[language][name]?.message ?? "",
    },
    runtime: { getManifest: () => ({ version: "1.3.0" }) },
    storage: {
      local: { get: async () => {
        if (storageError) throw new Error("Storage unavailable");
        return { blockedTotal: total };
      } },
      onChanged: { addListener(callback) { changed = callback; } },
    },
    tabs: {
      query: async () => [{ id: 7 }],
      sendMessage: async (id, message) => {
        assert.equal(id, 7);
        assert.equal(message.type, "rmu:get-status");
        if (reject) throw new Error("No receiver");
        return response;
      },
    },
  };
  vm.runInNewContext(popupScript, {
    browser, Intl,
    document: {
      documentElement,
      getElementById: id => elements.get(id),
      querySelectorAll: selector => (selector === "[data-i18n]" ? translated : labelled),
    },
  });
  await new Promise(setImmediate);
  const text = id => elements.get(id).textContent;
  return { elements, text, changed, translated, labelled, documentElement };
}

test("popup shows the lifetime total independently of the current page", async () => {
  const { elements, text } = await renderPopup(42, { active: true });
  assert.equal(text("version"), "1.3.0");
  assert.equal(elements.get("status").dataset.state, "active");
  assert.equal(text("status-title"), "Protecting this tab");
  assert.equal(text("status-detail"), "Reddit app prompts are blocked on this page.");
  assert.equal(text("total"), "42");
  assert.equal(text("total-label"), "app prompts blocked since installation");
});

test("popup keeps the lifetime total visible on other sites and updates it live", async () => {
  const { elements, text, changed } = await renderPopup(42, null, { reject: true });
  assert.equal(elements.get("status").dataset.state, "inactive");
  assert.equal(text("status-title"), "Not active on this tab");
  assert.match(text("status-detail"), /reload a Reddit tab/);
  assert.equal(text("total"), "42");
  changed({ blockedTotal: { newValue: 1043 } }, "local");
  assert.equal(text("total"), "1,043");
  changed({ blockedTotal: { newValue: 99 } }, "sync");
  assert.equal(text("total"), "1,043");
});

test("popup treats an inactive status reply as inactive", async () => {
  const { elements } = await renderPopup(0, { active: false });
  assert.equal(elements.get("status").dataset.state, "inactive");
});

test("popup normalizes missing totals and follows plural rules", async () => {
  const { text, changed } = await renderPopup(undefined, { active: true });
  assert.equal(text("total"), "0");
  assert.equal(text("total-label"), "app prompts blocked since installation");
  changed({ blockedTotal: { newValue: 1 } }, "local");
  assert.equal(text("total"), "1");
  assert.equal(text("total-label"), "app prompt blocked since installation");
  changed({ blockedTotal: { oldValue: 1 } }, "local");
  assert.equal(text("total"), "0");
});

test("popup shows a placeholder when the total cannot be read", async () => {
  const { text } = await renderPopup(5, { active: true }, { storageError: true });
  assert.equal(text("total"), "—");
});

test("popup is localized, including static text, numbers and plurals", async () => {
  const { text, translated, labelled, documentElement } =
    await renderPopup(12840, { active: true }, { language: "it" });
  assert.equal(documentElement.lang, "it");
  assert.equal(text("status-title"), "Protezione attiva");
  assert.equal(text("total"), "12.840");
  assert.equal(text("total-label"), "prompt dell’app bloccati dall’installazione");
  assert.deepEqual(translated.map(node => node.textContent), ["Codice sorgente", "Versione"]);
  assert.equal(labelled[0].attributes["aria-label"], "Link del progetto");
});

test("every locale defines every message used by the extension", () => {
  const used = new Set([
    ...[...popupHtml.matchAll(/data-i18n(?:-label)?="([^"]+)"/g)].map(match => match[1]),
    ...[...popupScript.matchAll(/"((?:status|total)[A-Za-z]+)"/g)].map(match => match[1]),
    "extensionDescription",
  ]);
  for (const [language, messages] of Object.entries(locales)) {
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(locales.en).sort(), language);
    for (const name of used) assert.ok(messages[name]?.message, `${language}: ${name}`);
  }
});

test("content CSS hides exactly the promotions the content script recognizes", () => {
  const css = unblockCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const hidden = css.slice(0, css.indexOf("{")).split(",").map(selector => selector.trim());
  const promo = [...unblockScript.match(/const PROMO = \[([\s\S]*?)\]\.join/)[1].matchAll(/"([^"]+)"/g)]
    .map(match => match[1]);
  const owner = unblockScript.match(/const OWNER = "([^"]+)"/)[1];
  const mark = unblockScript.match(/const MARK = "([^"]+)"/)[1];
  assert.deepEqual(hidden.sort(), [...promo, owner, `[${mark}]`].sort());
});

test("isolated script forwards only new blocks, including batched changes", async () => {
  let listener;
  let changed;
  const sent = [];
  const attributes = new Map([["data-rmu-active", "true"], ["data-rmu-prompts-blocked", "1"]]);
  vm.runInNewContext(statusScript, {
    browser: { runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      sendMessage: async message => { sent.push(message.delta); },
    } },
    document: { documentElement: { getAttribute: name => attributes.get(name) ?? null } },
    MutationObserver: class {
      constructor(callback) { changed = callback; }
      observe() {}
    },
  });
  await new Promise(setImmediate);
  assert.deepEqual(sent, [1]);
  attributes.set("data-rmu-prompts-blocked", "3");
  changed();
  changed();
  await new Promise(setImmediate);
  assert.deepEqual(sent, [1, 2]);
  assert.equal(listener({ type: "other" }), undefined);
  assert.equal((await listener({ type: "rmu:get-status" })).active, true);
});

test("background serializes simultaneous tab increments and persists the total", async () => {
  const values = {};
  const storage = {
    get: async key => ({ [key]: values[key] }),
    set: async update => { await new Promise(setImmediate); Object.assign(values, update); },
  };
  function startBackground() {
    let listener;
    vm.runInNewContext(backgroundScript, {
      browser: {
        runtime: { onMessage: { addListener(callback) { listener = callback; } } },
        storage: { local: storage },
      },
    });
    return listener;
  }
  let record = startBackground();
  await Promise.all([
    record({ type: "rmu:record-blocks", delta: 2 }, { tab: { id: 1 } }),
    record({ type: "rmu:record-blocks", delta: 3 }, { tab: { id: 2 } }),
  ]);
  assert.equal(values.blockedTotal, 5);
  record = startBackground();
  await record({ type: "rmu:record-blocks", delta: 1 }, { tab: { id: 3 } });
  assert.equal(values.blockedTotal, 6);
  assert.equal(record({ type: "rmu:record-blocks", delta: 1 }, {}), undefined);
  assert.equal(values.blockedTotal, 6);
});
