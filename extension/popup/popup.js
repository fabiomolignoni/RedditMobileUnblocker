"use strict";

const TOTAL_KEY = "blockedTotal";

const STATUS_TEXT = {
  active: ["Protecting this tab", "Reddit app prompts are blocked on this page."],
  inactive: ["Not active on this tab", "Open Reddit here, or reload a Reddit tab that was already open."],
};

const element = id => document.getElementById(id);

function renderStatus(state) {
  const [title, detail] = STATUS_TEXT[state];
  element("status").dataset.state = state;
  element("status-title").textContent = title;
  element("status-detail").textContent = detail;
}

function renderTotal(value) {
  const total = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  element("total").textContent = total.toLocaleString();
  element("total-label").textContent =
    `${total === 1 ? "app prompt" : "app prompts"} blocked since installation`;
}

async function loadTotal() {
  try {
    const stored = await browser.storage.local.get(TOTAL_KEY);
    renderTotal(stored[TOTAL_KEY]);
  } catch {
    element("total").textContent = "—";
  }
}

// The isolated content script answers only on supported Reddit pages, so any
// failure to reach it means protection is not running in this tab.
async function isProtectedTab() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return false;
    const status = await browser.tabs.sendMessage(tab.id, { type: "rmu:get-status" });
    return status?.active === true;
  } catch {
    return false;
  }
}

element("version").textContent = browser.runtime.getManifest().version;

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[TOTAL_KEY]) renderTotal(changes[TOTAL_KEY].newValue);
});

loadTotal();
isProtectedTab().then(active => renderStatus(active ? "active" : "inactive"));
