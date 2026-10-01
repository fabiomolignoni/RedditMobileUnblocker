import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const popupScript = readFileSync(new URL("../extension/popup/popup.js", import.meta.url), "utf8");
const statusScript = readFileSync(new URL("../extension/content/status.js", import.meta.url), "utf8");
const backgroundScript = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");

async function renderPopup(total, response, reject = false) {
  const elements = new Map(["#version", "#status-title", "#status-detail", "#status-dot", "#total-count"].map(id => [id, {
    textContent: "",
    active: false,
    classList: { toggle(name, active) { assert.equal(name, "active"); elements.get(id).active = active; } },
  }]));
  let changed;
  const browser = {
    runtime: { getManifest: () => ({ version: "1.2.0" }) },
    storage: {
      local: { get: async () => ({ blockedTotal: total }) },
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
    browser,
    document: { querySelector: selector => elements.get(selector) },
  });
  await new Promise(setImmediate);
  return { elements, changed };
}

test("popup shows the lifetime total independently of the current page", async () => {
  const { elements } = await renderPopup(42, { active: true });
  assert.equal(elements.get("#version").textContent, "1.2.0");
  assert.equal(elements.get("#status-title").textContent, "Active on this page");
  assert.equal(elements.get("#status-detail").textContent, "Protection is running on this page.");
  assert.equal(elements.get("#total-count").textContent, "42");
  assert.equal(elements.get("#status-dot").active, true);
});

test("popup keeps the lifetime total visible on other sites and updates it live", async () => {
  const { elements, changed } = await renderPopup(42, null, true);
  assert.equal(elements.get("#status-title").textContent, "Inactive on this page");
  assert.match(elements.get("#status-detail").textContent, /supported Reddit page/);
  assert.equal(elements.get("#status-dot").active, false);
  assert.equal(elements.get("#total-count").textContent, "42");
  changed({ blockedTotal: { newValue: 43 } }, "local");
  assert.equal(elements.get("#total-count").textContent, "43");
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
