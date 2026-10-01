(() => {
  "use strict";

  // The page-world protection code cannot access extension APIs. Observe its
  // per-page count here and forward only new blocks to extension storage.
  let reported = 0;
  let delivered = 0;
  let sending = false;

  function blockedOnPage() {
    const count = Number(document.documentElement?.getAttribute("data-rmu-prompts-blocked"));
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
  }

  function flush() {
    if (sending || delivered >= reported) return;
    sending = true;
    const delta = reported - delivered;
    browser.runtime.sendMessage({ type: "rmu:record-blocks", delta }).then(() => {
      delivered += delta;
      sending = false;
      flush();
    }, () => {
      sending = false;
    });
  }

  function recordNewBlocks() {
    reported = Math.max(reported, blockedOnPage());
    flush();
  }

  new MutationObserver(recordNewBlocks).observe(document, {
    attributes: true,
    subtree: true,
    attributeFilter: ["data-rmu-prompts-blocked"],
  });
  recordNewBlocks();

  browser.runtime.onMessage.addListener(message => {
    if (message?.type !== "rmu:get-status") return undefined;

    const root = document.documentElement;
    return Promise.resolve({
      active: root?.getAttribute("data-rmu-active") === "true",
    });
  });
})();
