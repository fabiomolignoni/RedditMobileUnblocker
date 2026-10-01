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
