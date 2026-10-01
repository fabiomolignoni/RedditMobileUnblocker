(() => {
  "use strict";

  // MAIN world is necessary to intercept page-owned preventDefault calls.
  // No extension APIs, credentials, remote code or privileged bridge live here.
  // Match component identity, never translated text, language tags or direction.
  // Keep this independent of both Reddit's language and the browser's locale.
  const PROMO = [
    "#app-upsell-blocking-bottom-sheet-direct",
    "#app-upsell-blocking-bottom-sheet-seo",
    "#desktop-dynamic-upsell-dialog",
    "#xpromo-bottom-sheet",
    "app-upsell-blocking-bottom-sheet-direct",
    "app-upsell-blocking-bottom-sheet-seo",
    ".configured-xpromo-bottom-sheet",
    ".configured-xpromo-full-screen",
  ].join(",");
  const MODAL = [
    "dialog[open]", '[aria-modal="true"]', '[role="dialog"]',
    '[role="alertdialog"]', '[role="menu"]', ".rpl-bottom-sheet",
    "faceplate-dialog[open]", "faceplate-modal[open]",
    "faceplate-bottom-sheet[open]", "[popover]",
  ].join(",");
  const ROOTS = "html, body, shreddit-app, main, #main-content";
  const LOCK_CLASSES = ["scroll-is-blocked", "rpl-scroll-lock", "scroll-disabled"];
  const LOCK_PROPERTIES = {
    overflow: /^(hidden|clip)$/,
    "overflow-x": /^(hidden|clip)$/,
    "overflow-y": /^(hidden|clip)$/,
    "pointer-events": /^none$/,
    "touch-action": /^none$/,
  };
  const CONTROLS = [
    "input", "textarea", "select", "button", "video", "audio", "canvas", "img",
    '[contenteditable]:not([contenteditable="false"])', '[role="slider"]',
    '[role="menu"]', '[role="listbox"]',
  ].join(",");
  const roots = new Map();
  const snapshots = new WeakMap();
  const modalPointers = new Map();
  let sawPromo = false;
  let blockedPrompts = 0;
  let queued = false;
  let lastRefresh = 0;

  function publishStatus() {
    const root = document.documentElement;
    if (!root) return;
    if (root.getAttribute("data-rmu-active") !== "true") root.setAttribute("data-rmu-active", "true");
    const count = String(blockedPrompts);
    if (root.getAttribute("data-rmu-prompts-blocked") !== count) {
      root.setAttribute("data-rmu-prompts-blocked", count);
    }
  }

  function refreshPromotionDate() {
    if (Date.now() - lastRefresh < 60_000) return;
    try {
      // Same date representation as uBO's $currentDate$, not epoch milliseconds.
      // Its effectiveness for Reddit's individual experiments is not guaranteed.
      localStorage.setItem("xpromo-consolidation", new Date().toString());
      lastRefresh = Date.now();
    } catch {
      // Storage can be unavailable; DOM protection must still start.
    }
  }

  function elements(selector) {
    const result = [];
    for (const [root, rootObserver] of roots) {
      if (root !== document && !root.host.isConnected) {
        rootObserver.disconnect();
        root.removeEventListener("toggle", schedule, true);
        roots.delete(root);
        continue;
      }
      result.push(...root.querySelectorAll(selector));
    }
    return result;
  }

  function parentAcrossShadow(node) {
    return node.parentElement || node.getRootNode().host || null;
  }

  function isPromotion(node) {
    for (let current = node; current instanceof Element; current = parentAcrossShadow(current)) {
      if (current.matches(PROMO)) return true;
    }
    return false;
  }

  function visible(node) {
    if (!node.isConnected || !node.getClientRects().length) return false;
    for (let current = node; current instanceof Element; current = parentAcrossShadow(current)) {
      const style = getComputedStyle(current);
      if (current.hidden || style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  }

  function hasOtherModal() {
    return elements(MODAL).some(node => !isPromotion(node) && visible(node));
  }

  function protectModalPointers(modals) {
    // A concurrent promo can set pointer-events:none on body. Keep the normal
    // dialog clickable without unlocking its backdrop, scroll lock or gestures.
    const inheritedBlock = elements(ROOTS).some(node => node.style.pointerEvents === "none");
    for (const [node, saved] of modalPointers) {
      if (inheritedBlock && modals.includes(node)) continue;
      if (node.style.pointerEvents === "auto" && node.style.getPropertyPriority("pointer-events") === "important") {
        if (saved[0]) node.style.setProperty("pointer-events", ...saved);
        else node.style.removeProperty("pointer-events");
      }
      modalPointers.delete(node);
    }
    if (!inheritedBlock) return;
    for (const node of modals) {
      if (getComputedStyle(node).pointerEvents !== "none" || node.style.pointerEvents === "none") continue;
      if (!modalPointers.has(node)) {
        modalPointers.set(node, [node.style.pointerEvents, node.style.getPropertyPriority("pointer-events")]);
      }
      node.style.setProperty("pointer-events", "auto", "important");
    }
  }

  function rememberUnlockedState(node) {
    let snapshot = snapshots.get(node);
    if (!snapshot) {
      snapshot = { styles: new Map(), inert: node.inert };
      snapshots.set(node, snapshot);
    }
    for (const [name, blocked] of Object.entries(LOCK_PROPERTIES)) {
      const value = node.style.getPropertyValue(name);
      // Horizontal clipping is a common part of Reddit's normal mobile layout.
      if (!blocked.test(value) || name === "overflow-x") {
        snapshot.styles.set(name, [value, node.style.getPropertyPriority(name)]);
      }
    }
    if (node.style.position !== "fixed") {
      for (const name of ["position", "top", "left", "right", "width"]) {
        snapshot.styles.set(name, [node.style.getPropertyValue(name), node.style.getPropertyPriority(name)]);
      }
    }
    snapshot.inert = node.inert;
  }

  function restoreProperty(node, name) {
    const saved = snapshots.get(node)?.styles.get(name);
    if (saved?.[0]) {
      if (node.style.getPropertyValue(name) !== saved[0] || node.style.getPropertyPriority(name) !== saved[1]) {
        node.style.setProperty(name, ...saved);
      }
    } else if (node.style.getPropertyValue(name)) {
      node.style.removeProperty(name);
    }
  }

  function unlockPage() {
    let scrollOffset = null;
    for (const node of elements(ROOTS)) {
      if (isPromotion(node)) continue;
      // Only page roots: nested carousels and media retain their own styles.
      for (const name of LOCK_CLASSES) {
        if (node.classList.contains(name)) node.classList.remove(name);
      }
      if (LOCK_PROPERTIES.overflow.test(node.style.overflow)) {
        // Removing the shorthand also removes overflow-x/y. Restore the group
        // together so an existing horizontal clip survives a vertical unlock.
        for (const name of ["overflow", "overflow-x", "overflow-y"]) restoreProperty(node, name);
      }
      for (const [name, blocked] of Object.entries(LOCK_PROPERTIES)) {
        if (blocked.test(node.style.getPropertyValue(name))) restoreProperty(node, name);
      }
      if (node === document.body && node.style.position === "fixed") {
        const top = node.style.top;
        if (/^-\d+(?:\.\d+)?px$/.test(top)) scrollOffset = -parseFloat(top);
        for (const name of ["position", "top", "left", "right", "width"]) restoreProperty(node, name);
      }
      // Do not strip inert from arbitrary subtrees or from initially inert content.
      if (node.inert && (snapshots.get(node)?.inert === false ||
          node === document.body || node === document.documentElement)) {
        node.inert = false;
      }
    }
    if (scrollOffset !== null) window.scrollTo({ top: scrollOffset, behavior: "instant" });
  }

  function suppress(node) {
    sawPromo = true;
    if (!node.hasAttribute("data-rmu-suppressed")) {
      node.setAttribute("data-rmu-suppressed", "");
      blockedPrompts += 1;
      publishStatus();
    }
    // Inline hiding also reaches known components inside an open shadow root.
    if (node.style.getPropertyValue("display") !== "none" ||
        node.style.getPropertyPriority("display") !== "important") {
      node.style.setProperty("display", "none", "important");
    }
  }

  function closePromotionalLayers() {
    // Native top-layer elements can remain modal even inside a hidden ancestor.
    // Search every observed root, including nested component shadow trees.
    for (const dialog of elements("dialog[open], :popover-open")) {
      if (!isPromotion(dialog)) continue;
      if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
      if (dialog.matches(":popover-open")) dialog.hidePopover();
    }
  }

  function sweep() {
    queued = false;
    publishStatus();
    const promos = elements(PROMO);
    // Capture before hiding, while still preserving earlier unlocked snapshots.
    if (!sawPromo && promos.length === 0 && !hasOtherModal()) {
      for (const node of elements(ROOTS)) rememberUnlockedState(node);
    }
    for (const node of promos) suppress(node);
    if (sawPromo) closePromotionalLayers();
    // Keep the rescue after suppression: page-owned listeners may outlive a panel.
    // Any visible normal dialog/menu suspends the rescue, including its touch guard.
    if (sawPromo) {
      const modals = elements(MODAL).filter(node => !isPromotion(node) && visible(node));
      if (modals.length === 0) unlockPage();
      protectModalPointers(modals);
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(sweep);
  }

  function discover(node) {
    if (![Node.ELEMENT_NODE, Node.DOCUMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(node.nodeType)) return;
    if (node.shadowRoot) observe(node.shadowRoot);
    for (const child of node.querySelectorAll("*")) {
      if (child.shadowRoot) observe(child.shadowRoot);
    }
  }

  function changed(records) {
    for (const record of records) {
      for (const node of record.addedNodes) discover(node);
    }
    schedule();
  }

  function observe(root) {
    if (roots.has(root)) return;
    const observer = new MutationObserver(changed);
    roots.set(root, observer);
    // Popover state changes do not mutate an attribute. Capture also handles
    // non-bubbling toggle events inside each open shadow root.
    root.addEventListener("toggle", schedule, true);
    observer.observe(root, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["id", "class", "style", "open", "hidden", "inert", "role", "aria-modal", "popover"],
    });
    discover(root);
  }

  // Components can attach their shadow tree well after their host was inserted.
  // Preserve closed roots; observe open roots without changing their semantics.
  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function () {
    const root = Reflect.apply(originalAttachShadow, this, arguments);
    if (root.mode === "open") {
      observe(root);
      schedule();
    }
    return root;
  };

  const originalPreventDefault = Event.prototype.preventDefault;
  Event.prototype.preventDefault = function () {
    const globalTarget = this.currentTarget === window || this.currentTarget === document ||
      this.currentTarget === document.documentElement || this.currentTarget === document.body;
    if (sawPromo && globalTarget && (this.type === "touchmove" || this.type === "wheel") &&
        !this.ctrlKey && !this.metaKey && !this.altKey && !this.shiftKey &&
        !(this.touches?.length > 1) && !hasOtherModal()) {
      const control = this.composedPath().some(node => node instanceof Element && node.matches(CONTROLS));
      if (!control) return;
    }
    return Reflect.apply(originalPreventDefault, this, arguments);
  };

  refreshPromotionDate();
  observe(document);
  sweep();
  window.addEventListener("pageshow", () => {
    refreshPromotionDate();
    discover(document);
    schedule();
  });
  window.addEventListener("popstate", () => {
    refreshPromotionDate();
    schedule();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshPromotionDate();
      discover(document);
      schedule();
    }
  });
})();
