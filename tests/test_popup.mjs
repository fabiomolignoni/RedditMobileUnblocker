import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const popupScript = readFileSync(new URL("../extension/popup/popup.js", import.meta.url), "utf8");
const statusScript = readFileSync(new URL("../extension/content/status.js", import.meta.url), "utf8");
const backgroundScript = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");

async function renderPopup(total, response, { reject = false, storageError = false } = {}) {
  const elements = new Map(["version", "status", "status-title", "status-detail", "total", "total-label"]
    .map(id => [id, { textContent: "", dataset: {} }]));
  let changed;
  const browser = {
    runtime: { getManifest: () => ({ version: "1.2.0" }) },
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
    browser,
    document: { getElementById: id => elements.get(id) },
  });
  await new Promise(setImmediate);
  const text = id => elements.get(id).textContent;
  return { elements, text, changed };
}

test("popup shows the lifetime total independently of the current page", async () => {
  const { elements, text } = await renderPopup(42, { active: true });
  assert.equal(text("version"), "1.2.0");
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
  changed({ blockedTotal: { newValue: 43 } }, "local");
  assert.equal(text("total"), "43");
  changed({ blockedTotal: { newValue: 99 } }, "sync");
  assert.equal(text("total"), "43");
});

test("popup treats an inactive status reply as inactive", async () => {
  const { elements } = await renderPopup(0, { active: false });
  assert.equal(elements.get("status").dataset.state, "inactive");
});

test("popup normalizes missing totals and uses the singular label for one block", async () => {
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
