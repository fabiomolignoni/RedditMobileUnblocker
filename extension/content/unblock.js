(() => {
  "use strict";

  // Runs in the page's MAIN world at document_start so it can wrap page-owned
  // preventDefault and attachShadow before Reddit's scripts run. It uses no
  // extension APIs and holds no privileged data. Promotions are recognized by
  // component identity (ids, element names, classes), never by translated text,
  // language tags or direction, so behavior is the same in every language.

  // Promotional layers. Keep in sync with unblock.css, whose user-origin rules
  // hide them in every tree (including closed shadow roots) before first paint.
  // Reddit renders a bottom sheet or dialog as a separate "portal" element that
  // receives the sheet's dialog-id and dialog-classname, so ids and classes here
  // match that portal rather than the component that requested it.
  const PROMO = [
    "#app-upsell-blocking-bottom-sheet-direct",
    "#app-upsell-blocking-bottom-sheet-seo",
    "#desktop-dynamic-upsell-dialog",
    "#xpromo-bottom-sheet",
    "app-upsell-blocking-bottom-sheet-direct",
    "app-upsell-blocking-bottom-sheet-seo",
    ".configured-xpromo",
    ".configured-xpromo-bottom-sheet",
    ".configured-xpromo-full-screen",
  ].join(",");
  // The component that opens a configured promotion. When its sheet opens, Reddit's
  // own dismissal event tears the promotion down even if the portal is unrecognized.
  const OWNER = "configured-xpromo-modal";
  const OWNER_MODAL = "rpl-bottom-sheet, rpl-dialog";
  // Ordinary overlays that legitimately lock the page while visible.
  const MODAL = [
    "dialog[open]", '[aria-modal="true"]', '[role="dialog"]', '[role="alertdialog"]',
    '[role="menu"]', ".rpl-bottom-sheet", ".rpl-dialog", "faceplate-dialog[open]",
    "faceplate-modal[open]", "faceplate-bottom-sheet[open]", "[popover]",
  ].join(",");
  const INTERESTING = [PROMO, OWNER, OWNER_MODAL, MODAL].join(",");
  // Page roots that a promotion locks; only these are ever unlocked.
  const ROOTS = "html, body, shreddit-app, main, #main-content";
  const LOCK_CLASSES = ["scroll-is-blocked", "rpl-scroll-lock", "scroll-disabled"];
  const LOCK_PROPERTIES = {
    overflow: /^(hidden|clip)$/,
    "overflow-x": /^(hidden|clip)$/,
    "overflow-y": /^(hidden|clip)$/,
    "pointer-events": /^none$/,
    "touch-action": /^none$/,
  };
  const FIXED_BODY_PROPERTIES = ["position", "top", "left", "right", "width"];
  // Gestures that start here may legitimately need a page-level preventDefault.
  // Images, videos and buttons are not included: a scroll that starts on them
  // must not stay frozen, and their own (non page-level) listeners are untouched.
  const CONTROLS = [
    "input", "textarea", "select", "canvas", '[contenteditable]:not([contenteditable="false"])',
    '[role="slider"]', '[role="menu"]', '[role="listbox"]',
  ].join(",");
  const MARK = "data-rmu-suppressed";
  const CONTENT_OPTIONS = {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ["id", "class", "open", "hidden", "role", "aria-modal", "popover"],
  };
  const ROOT_OPTIONS = { attributes: true, attributeFilter: ["class", "style", "inert"] };

  const observer = new MutationObserver(onMutations);
  const observedRoots = new WeakSet();
  const watchedRoots = new WeakSet();
  const closedRoots = new WeakMap();
  const snapshots = new WeakMap();
  const counted = new WeakSet();
  const dismissed = new WeakSet();
  const modalCandidates = new Set();
  const modalPointers = new Map();
  let sawPromo = false;
  let rootsChanged = false;
  let modalsDirty = true;
  let modalCache = [];
  let frameRequested = false;
  let blockedPrompts = 0;
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

  // Tree helpers ---------------------------------------------------------------

  function shadowOf(element) {
    return element.shadowRoot || closedRoots.get(element) || null;
  }

  function parentAcrossShadow(node) {
    return node.parentElement || node.getRootNode().host || null;
  }

  function isPromotion(node) {
    for (let current = node; current instanceof Element; current = parentAcrossShadow(current)) {
      if (current.hasAttribute(MARK) || current.localName === OWNER || current.matches(PROMO)) return true;
    }
    return false;
  }

  // The element and all of its descendants, including those in shadow trees.
  function* subtree(element) {
    const pending = [element];
    while (pending.length) {
      const current = pending.pop();
      if (current instanceof Element) yield current;
      const shadow = current instanceof Element ? shadowOf(current) : null;
      if (shadow) pending.push(shadow);
      pending.push(...current.children);
    }
  }

  // Style-only check: it never forces a synchronous layout of the page.
  function visible(node) {
    return node.checkVisibility({ checkVisibilityCSS: true });
  }

  // Visible ordinary dialogs and menus, recomputed only after the DOM changed.
  function openModals() {
    if (!modalsDirty) return modalCache;
    modalsDirty = false;
    modalCache = [];
    for (const node of modalCandidates) {
      if (!node.isConnected) modalCandidates.delete(node);
      else if (!isPromotion(node) && visible(node)) modalCache.push(node);
    }
    return modalCache;
  }

  function rootElements() {
    return document.querySelectorAll(ROOTS);
  }

  // Detection -------------------------------------------------------------------

  // A configured promotion's portal carries the dialog-id of the sheet inside
  // its owner, so both are counted as one prompt.
  function ownerOf(node) {
    if (node.id) {
      for (const owner of document.getElementsByTagName(OWNER)) {
        for (const modal of owner.querySelectorAll(OWNER_MODAL)) {
          if (modal.getAttribute("dialog-id") === node.id) return owner;
        }
      }
    }
    return node;
  }

  function count(prompt) {
    if (counted.has(prompt)) return;
    counted.add(prompt);
    blockedPrompts += 1;
    publishStatus();
  }

  function closeLayer(element) {
    if (element instanceof HTMLDialogElement && element.open) element.close();
    if (element.matches(":popover-open")) element.hidePopover();
  }

  function suppress(node) {
    if (node.hasAttribute(MARK)) return;
    // CSS hides marked nodes in every tree; no inline styles are written.
    node.setAttribute(MARK, "");
    sawPromo = true;
    if (!isPromotion(parentAcrossShadow(node))) count(ownerOf(node));
    // Native top-layer dialogs and popovers stay modal inside a hidden ancestor.
    // Focus inside the hidden promotion is reset by the browser's focus fixup.
    for (const element of subtree(node)) closeLayer(element);
  }

  function ownerOpened(owner) {
    suppress(owner);
    if (dismissed.has(owner)) return;
    dismissed.add(owner);
    // Reddit's own dismissal path hides the sheet, releases its scroll lock and
    // removes the promotion; unknown listeners simply ignore the event.
    owner.dispatchEvent(new CustomEvent("dismiss-configured-xpromo"));
  }

  function inspectElement(element, attribute) {
    if (!element.matches(INTERESTING)) return;
    if (element.matches(PROMO)) suppress(element);
    if (element.matches(OWNER_MODAL) && element.hasAttribute("open")) {
      const owner = element.closest(OWNER);
      if (owner) ownerOpened(owner);
    }
    if (element.matches(MODAL)) {
      modalCandidates.add(element);
      if (attribute === "open" && sawPromo && isPromotion(element)) closeLayer(element);
    }
  }

  function inspect(node) {
    if (node instanceof Element) {
      inspectElement(node);
      if (node.shadowRoot) observe(node.shadowRoot);
    }
    for (const element of node.querySelectorAll(INTERESTING)) inspectElement(element);
    // Declarative shadow roots bypass attachShadow; find them in inserted trees.
    for (const element of node.querySelectorAll("*")) {
      if (element.shadowRoot) observe(element.shadowRoot);
    }
    if (node.getRootNode() === document) {
      if (node instanceof Element && node.matches(ROOTS)) watchRoot(node);
      for (const element of node.querySelectorAll(ROOTS)) watchRoot(element);
    }
  }

  // Unlocking -------------------------------------------------------------------

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
      for (const name of FIXED_BODY_PROPERTIES) {
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
    for (const node of rootElements()) {
      if (isPromotion(node)) continue;
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
        for (const name of FIXED_BODY_PROPERTIES) restoreProperty(node, name);
      }
      // Do not strip inert from arbitrary subtrees or from initially inert content.
      if (node.inert && (snapshots.get(node)?.inert === false ||
          node === document.body || node === document.documentElement)) {
        node.inert = false;
      }
    }
    if (scrollOffset !== null) window.scrollTo({ top: scrollOffset, behavior: "instant" });
  }

  function protectModalPointers(modals) {
    // A concurrent promo can set pointer-events:none on body. Keep the normal
    // dialog clickable without unlocking its backdrop, scroll lock or gestures.
    const inheritedBlock = [...rootElements()].some(node => node.style.pointerEvents === "none");
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

  // Before any promotion, record the roots' own inline state (cheap, and it must
  // precede the promotion's locks). Afterwards, unlock once per animation frame,
  // when the browser computes styles anyway, unless an ordinary modal is visible.
  function settle() {
    modalsDirty = true;
    if (!sawPromo) {
      if (rootsChanged) {
        for (const node of rootElements()) rememberUnlockedState(node);
        rootsChanged = false;
      }
    } else if (!frameRequested) {
      frameRequested = true;
      requestAnimationFrame(rescue);
    }
  }

  function rescue() {
    frameRequested = false;
    const modals = openModals();
    if (modals.length === 0) unlockPage();
    protectModalPointers(modals);
  }

  // Observation -----------------------------------------------------------------

  // Records are processed incrementally: only inserted subtrees and changed
  // elements are inspected, so cost follows page activity, not page size.
  function onMutations(records) {
    for (const record of records) {
      // Records describe the past: skip nodes that have been removed since.
      if (record.type === "childList") {
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.isConnected) inspect(node);
        }
      } else if (record.target.isConnected) {
        if (watchedRoots.has(record.target)) rootsChanged = true;
        if (record.attributeName !== "style" && record.attributeName !== "inert") {
          inspectElement(record.target, record.attributeName);
        }
      }
    }
    settle();
  }

  function onToggle(event) {
    // Popover state changes do not mutate attributes.
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches(MODAL)) modalCandidates.add(target);
    if (event.newState === "open" && isPromotion(target)) closeLayer(target);
    settle();
  }

  function observe(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
    observer.observe(root, CONTENT_OPTIONS);
    // Capture also sees non-bubbling toggle events inside each shadow root.
    root.addEventListener("toggle", onToggle, true);
    inspect(root);
  }

  function watchRoot(element) {
    if (watchedRoots.has(element)) return;
    watchedRoots.add(element);
    observer.observe(element, ROOT_OPTIONS);
    rootsChanged = true;
  }

  // Components can attach their shadow tree well after their host was inserted.
  // Closed roots stay private to this closure; observing them does not expose them.
  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function attachShadow() {
    const root = Reflect.apply(originalAttachShadow, this, arguments);
    if (root.mode === "closed") closedRoots.set(this, root);
    observe(root);
    return root;
  };

  // After a promotion, page-wide touchmove/wheel blockers would keep the page
  // frozen. Ignore their preventDefault only on page-level targets, and never for
  // CONTROLS, multitouch, modifier keys or while an ordinary modal is open.
  const SCROLL_EVENTS = new Set(["touchmove", "wheel"]);
  const originalPreventDefault = Event.prototype.preventDefault;
  Event.prototype.preventDefault = function preventDefault() {
    if (sawPromo && SCROLL_EVENTS.has(this.type)) {
      const target = this.currentTarget;
      const pageTarget = target === window || target === document ||
        target === document.documentElement || target === document.body;
      if (pageTarget && !this.ctrlKey && !this.metaKey && !this.altKey && !this.shiftKey &&
          !(this.touches?.length > 1) &&
          !this.composedPath().some(node => node instanceof Element && node.matches(CONTROLS)) &&
          openModals().length === 0) {
        return;
      }
    }
    return Reflect.apply(originalPreventDefault, this, arguments);
  };

  publishStatus();
  refreshPromotionDate();
  observe(document);
  settle();
  window.addEventListener("pageshow", () => {
    refreshPromotionDate();
    settle();
  });
  window.addEventListener("popstate", refreshPromotionDate);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshPromotionDate();
  });
})();
