"use strict";

const TOTAL_KEY = "blockedTotal";
const LANGUAGE = browser.i18n.getUILanguage();
const numbers = new Intl.NumberFormat(LANGUAGE);
const plurals = new Intl.PluralRules(LANGUAGE);

const STATUS_TEXT = {
  active: ["statusActive", "statusActiveDetail"],
  inactive: ["statusInactive", "statusInactiveDetail"],
};

const element = id => document.getElementById(id);
const message = name => browser.i18n.getMessage(name);

function localize() {
  document.documentElement.lang = LANGUAGE;
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = message(node.dataset.i18n);
  for (const node of document.querySelectorAll("[data-i18n-label]")) {
    node.setAttribute("aria-label", message(node.dataset.i18nLabel));
  }
}

function renderStatus(state) {
  const [title, detail] = STATUS_TEXT[state];
  element("status").dataset.state = state;
  element("status-title").textContent = message(title);
  element("status-detail").textContent = message(detail);
}

function renderTotal(value) {
  const total = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  element("total").textContent = numbers.format(total);
  element("total-label").textContent = message(plurals.select(total) === "one" ? "totalOne" : "totalOther");
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

localize();
element("version").textContent = browser.runtime.getManifest().version;

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[TOTAL_KEY]) renderTotal(changes[TOTAL_KEY].newValue);
});

loadTotal();
isProtectedTab().then(active => renderStatus(active ? "active" : "inactive"));
