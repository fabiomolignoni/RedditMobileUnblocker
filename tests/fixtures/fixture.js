"use strict";
try {
  window.atFirstPageScript = localStorage.getItem("xpromo-consolidation");
} catch {
  window.atFirstPageScript = "storage-unavailable";
}
window.frameSawPromo = null;
window.showPromo = function (
  id = "app-upsell-blocking-bottom-sheet-direct",
  native = false,
  text = "Get the app to keep using Reddit",
) {
  const promo = document.createElement(native ? "dialog" : "div");
  promo.id = id;
  promo.className = "rpl-bottom-sheet";
  promo.textContent = text;
  document.body.append(promo);
  if (native) promo.showModal();
  document.body.classList.add("scroll-is-blocked", "rpl-scroll-lock");
  document.body.style.overflow = "hidden";
  document.body.style.pointerEvents = "none";
  document.body.style.touchAction = "none";
  document.querySelector("main").inert = true;
  document.addEventListener("touchmove", event => event.preventDefault(), { passive: false });
  document.addEventListener("wheel", event => event.preventDefault(), { passive: false });
  requestAnimationFrame(() => { window.frameSawPromo = getComputedStyle(promo).display !== "none"; });
  return promo;
};
window.showNormalDialog = function () {
  const dialog = document.createElement("dialog");
  dialog.id = "login-dialog";
  dialog.innerHTML = '<label>Username <input id="username"></label><button id="close">Close</button>';
  document.body.append(dialog);
  dialog.showModal();
  document.body.classList.add("scroll-is-blocked");
  document.body.style.overflow = "hidden";
  dialog.querySelector("button").onclick = () => dialog.close();
  return dialog;
};

// Minimal stand-ins for Reddit's components, mirroring the structure observed on the
// live site: a sheet renders a separate portal that receives its dialog-id and
// dialog-classname, holds an overlay and an aria-modal panel in an open shadow root,
// takes the sheet's content and locks the body. Its owner honors Reddit's dismissal.
customElements.define("rpl-bottom-sheet", class extends HTMLElement {
  showModal() {
    const portal = document.createElement("div");
    portal.id = this.getAttribute("dialog-id") || "";
    portal.className = `rpl-bottom-sheet ${this.getAttribute("dialog-classname") || ""}`.trim();
    portal.attachShadow({ mode: "open" }).innerHTML =
      '<div part="overlay" style="position:fixed;inset:0;background:rgb(0 0 0 / 50%)"></div>' +
      '<div part="panel" role="dialog" aria-modal="true" style="position:fixed;inset:auto 0 0;height:40%;background:white"><slot></slot></div>';
    portal.append(...this.childNodes);
    document.body.append(portal);
    this.portal = portal;
    this.setAttribute("open", "");
    document.body.classList.add("rpl-scroll-lock");
    return portal;
  }
  hide() {
    this.portal?.remove();
    this.removeAttribute("open");
    document.body.classList.remove("rpl-scroll-lock");
    this.dispatchEvent(new Event("rpl-bottom-sheet:after-hide", { bubbles: true }));
  }
});
customElements.define("configured-xpromo-modal", class extends HTMLElement {
  connectedCallback() {
    this.addEventListener("dismiss-configured-xpromo", () => {
      this.dismissing = true;
      this.querySelector("rpl-bottom-sheet").hide();
    });
    this.addEventListener("rpl-bottom-sheet:after-hide", () => this.dismissing && this.remove());
  }
  showModal() {
    return this.querySelector("rpl-bottom-sheet").showModal();
  }
});
window.showRedditPrompt = function (dialogId, dialogClass) {
  const owner = document.createElement("configured-xpromo-modal");
  owner.innerHTML = '<rpl-bottom-sheet><p>Get the app to keep using Reddit</p></rpl-bottom-sheet>';
  const sheet = owner.firstElementChild;
  sheet.setAttribute("dialog-id", dialogId);
  if (dialogClass) sheet.setAttribute("dialog-classname", dialogClass);
  document.body.append(owner);
  // Page-level gesture blockers like those of Reddit's blocking controller.
  document.addEventListener("touchmove", event => event.preventDefault(), { passive: false });
  document.addEventListener("wheel", event => event.preventDefault(), { passive: false });
  document.body.classList.add("scroll-is-blocked");
  const portal = owner.showModal();
  requestAnimationFrame(() => {
    window.frameSawPromo = portal.isConnected && getComputedStyle(portal).display !== "none";
  });
  return portal;
};
window.showRedditDialog = function (dialogId) {
  const sheet = document.createElement("rpl-bottom-sheet");
  sheet.setAttribute("dialog-id", dialogId);
  sheet.innerHTML = '<button id="consent-reject">Reject</button>';
  document.body.append(sheet);
  sheet.showModal();
  return sheet;
};
