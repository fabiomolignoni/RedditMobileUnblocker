"use strict";

document.querySelector("#version").textContent = browser.runtime.getManifest().version;

function showStatus(title, detail, active) {
  document.querySelector("#status-title").textContent = title;
  document.querySelector("#status-detail").textContent = detail;
  document.querySelector("#status-dot").classList.toggle("active", active);
}

function showTotal(value) {
  const count = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  document.querySelector("#total-count").textContent = count.toLocaleString();
}

async function updateTotal() {
  const stored = await browser.storage.local.get("blockedTotal");
  showTotal(stored.blockedTotal);
}

async function updateStatus() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error("No active tab");
    const status = await browser.tabs.sendMessage(tab.id, { type: "rmu:get-status" });
    if (!status?.active) throw new Error("Protection is not running on this page");

    showStatus("Active on this page", "Protection is running on this page.", true);
  } catch {
    showStatus("Inactive on this page", "Open a supported Reddit page and reload it.", false);
  }
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.blockedTotal) showTotal(changes.blockedTotal.newValue);
});

updateTotal().catch(() => {
  document.querySelector("#total-count").textContent = "—";
});
updateStatus();
