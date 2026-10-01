"use strict";

const TOTAL_KEY = "blockedTotal";
let pending = Promise.resolve();

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "rmu:record-blocks" || !sender.tab ||
      !Number.isSafeInteger(message.delta) || message.delta < 1) return undefined;

  // Serialize reads and writes so simultaneous tabs cannot overwrite each other.
  const update = pending.then(async () => {
    const stored = await browser.storage.local.get(TOTAL_KEY);
    const previous = stored[TOTAL_KEY];
    const total = Number.isSafeInteger(previous) && previous >= 0 ? previous : 0;
    const next = Math.min(Number.MAX_SAFE_INTEGER, total + message.delta);
    await browser.storage.local.set({ [TOTAL_KEY]: next });
    return next;
  });
  pending = update.catch(() => {});
  return update;
});
