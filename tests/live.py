"""Check the extension against live Reddit in a real Firefox.

Three complementary checks run on each page:

* Timed prompt (deterministic canary): the prompt is delivered the way Reddit's server
  sends it, as markup whose <ac-call trigger="init" delay="30000" method="showModal">
  lets Reddit's own action runtime open it after 30 s. Reddit's components then cover
  and lock the page by themselves. A control run without the extension proves that the
  page is usable at first and blocked once the timer fires; with the extension the
  page must stay usable after the timer.
* Simulated prompt (deterministic): Reddit's own components (configured-xpromo-modal
  with rpl-bottom-sheet or rpl-dialog) open an app prompt immediately, together with
  page-level touchmove/wheel blockers like those of Reddit's blocking controller, in
  several identities. A control run without the extension proves it blocks the page.
* Natural prompt (opportunistic): while the timed prompt waits, the page is watched
  for Reddit's own prompt. Reddit serves it only to some sessions (it targets frequent
  logged-out visitors, which a fresh profile is not), so "not served" is information,
  not a failure. When it is served, its markup is saved next to the screenshots.

A page counts as usable when no overlay covers it, roots are not locked, a real
scroll gesture moves it, and no app-promotion layer is visible.

Usage:
    python3 tests/live.py                        # mobile emulation in headless Firefox
    python3 tests/live.py --headed --wait 60     # watch it, give Reddit more time
    python3 tests/live.py --android SERIAL       # Firefox on a USB-connected phone

Desktop runs need Firefox 144+ and geckodriver (as for `npm test`). Android runs need
adb, geckodriver 0.36+, and "Remote debugging via USB" enabled in Firefox settings.
Exit status: 0 usable everywhere, 1 a check failed, 2 the run could not be performed or
was inconclusive (a WARN, such as a control that did not block: the simulation no
longer matches Reddit and must be updated).
"""
import argparse
from datetime import datetime
import json
from pathlib import Path
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from scripts.build import build  # noqa: E402
from browser import Firefox  # noqa: E402

DEFAULT_URLS = [
    "https://www.reddit.com/r/AskReddit/",
    "https://www.reddit.com/r/bugs/comments/1suktyl/cannot_use_reddit_on_android/",
]
MOBILE_UA = "Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0"
VARIANTS = {
    # Identities observed on Reddit: the portal receives dialog-id and dialog-classname.
    "blocking-sheet": ("rpl-bottom-sheet", "app-upsell-blocking-bottom-sheet-direct",
                       "configured-xpromo configured-xpromo-bottom-sheet"),
    "full-screen": ("rpl-bottom-sheet", "xpromo-bottom-sheet", "configured-xpromo configured-xpromo-full-screen"),
    "dialog": ("rpl-dialog", "desktop-dynamic-upsell-dialog", "configured-xpromo"),
    # An identity the extension does not know: only Reddit's own dismissal can help.
    "unknown-identity": ("rpl-bottom-sheet", "xpromo-unrecognized-variant", ""),
}

DISMISS_CONSENT = """
    const button = document.querySelector('#data-protection-consent-dialog button[slot="secondary-button"]');
    if (button) button.click();
    return Boolean(button);
"""

# With a delay (ms), the prompt is only delivered, as Reddit's server sends it: an
# <ac-call> lets Reddit's action runtime call showModal() on its parent owner when the
# delay expires, and Reddit's components lock the page on their own. Without a delay,
# it opens at once with page-level gesture blockers added. Simulated owners carry
# data-live-test so they are not mistaken for Reddit's own prompts.
SIMULATE = """
    const [sheetName, dialogId, dialogClass, delay, done] = arguments;
    const defined = name => Promise.race([
        customElements.whenDefined(name),
        new Promise((_, reject) => setTimeout(() => reject(new Error(name + ' is not defined')), 15000)),
    ]);
    (async () => {
        const names = ['configured-xpromo-modal', sheetName, 'rpl-modal-card'];
        if (delay !== null) names.push('ac-call');
        for (const name of names) await defined(name);
        const owner = document.createElement('configured-xpromo-modal');
        owner.setAttribute('data-live-test', '');
        const sheet = document.createElement(sheetName);
        sheet.setAttribute('dialog-id', dialogId);
        if (dialogClass) sheet.setAttribute('dialog-classname', dialogClass);
        const card = document.createElement('rpl-modal-card');
        const title = document.createElement('span');
        title.slot = 'title';
        title.textContent = 'Get the app to keep using Reddit';
        card.append(title);
        sheet.append(card);
        owner.append(sheet);
        if (delay !== null) {
            const call = document.createElement('ac-call');
            call.setAttribute('trigger', 'init');
            call.setAttribute('delay', String(delay));
            call.setAttribute('method', 'showModal');
            owner.append(call);
            document.body.append(owner);
            return;
        }
        document.body.append(owner);
        // Equivalent of Reddit's blocking controller: page-level gesture blockers.
        const block = event => event.preventDefault();
        for (const type of ['touchmove', 'wheel']) document.addEventListener(type, block, { passive: false });
        document.body.classList.add('scroll-is-blocked');
        await owner.showModal();
    })().then(() => done({ ok: true }), error => done({ ok: false, error: String(error) }));
"""

INSPECT = """
    const PROMO = '#app-upsell-blocking-bottom-sheet-direct, #app-upsell-blocking-bottom-sheet-seo, ' +
        '#desktop-dynamic-upsell-dialog, #xpromo-bottom-sheet, app-upsell-blocking-bottom-sheet-direct, ' +
        'app-upsell-blocking-bottom-sheet-seo, .configured-xpromo, .configured-xpromo-bottom-sheet, ' +
        '.configured-xpromo-full-screen';
    const OVERLAY = '[aria-modal="true"], dialog:modal, .rpl-bottom-sheet, .rpl-dialog, ' + PROMO;
    const describe = el => el.localName + (el.id ? '#' + el.id : '') +
        (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '');
    const up = el => el.parentElement || (el.getRootNode() instanceof ShadowRoot ? el.getRootNode().host : null);
    const covering = [];
    for (const y of [0.3, 0.5, 0.75]) {
        let el = document.elementFromPoint(innerWidth / 2, innerHeight * y);
        // Descend into open shadow trees to the real hit target.
        while (el?.shadowRoot) {
            const inner = el.shadowRoot.elementFromPoint(innerWidth / 2, innerHeight * y);
            if (!inner || inner === el) break;
            el = inner;
        }
        for (let node = el; node; node = up(node)) {
            if (node.matches(OVERLAY)) { covering.push(describe(node)); break; }
        }
    }
    const locked = [];
    for (const el of [document.documentElement, document.body, document.querySelector('main')]) {
        if (!el) continue;
        const style = getComputedStyle(el);
        if (/hidden|clip/.test(style.overflowY) && el !== document.querySelector('main')) locked.push(describe(el) + ' overflow');
        if (style.pointerEvents === 'none') locked.push(describe(el) + ' pointer-events');
        if (el.inert) locked.push(describe(el) + ' inert');
    }
    const visiblePromos = [];
    const walk = root => {
        for (const el of root.querySelectorAll('*')) {
            if (el.matches(PROMO) && el.checkVisibility({ checkVisibilityCSS: true })) visiblePromos.push(describe(el));
            if (el.shadowRoot) walk(el.shadowRoot);
        }
    };
    walk(document);
    const root = document.documentElement;
    const simulated = document.querySelector('configured-xpromo-modal[data-live-test]');
    return {
        app: Boolean(document.querySelector('shreddit-app')),
        active: root.getAttribute('data-rmu-active') === 'true',
        blocked: Number(root.getAttribute('data-rmu-prompts-blocked') || 0),
        // Reddit's own prompt owners, not the simulated one.
        owners: document.querySelectorAll('configured-xpromo-modal:not([data-live-test])').length,
        // The simulated prompt: waiting for its timer, open, or gone (dismissed).
        simulated: simulated ? (simulated.querySelector(':scope > [open]') ? 'open' : 'waiting') : null,
        covering: [...new Set(covering)],
        locked,
        visiblePromos: [...new Set(visiblePromos)],
        scrollY: Math.round(scrollY),
    };
"""


FIND_MEDIA = """
    // A visible image or video well inside the viewport, to start a gesture on it.
    const walk = function* (root) {
        for (const el of root.querySelectorAll('*')) {
            yield el;
            if (el.shadowRoot) yield* walk(el.shadowRoot);
        }
    };
    for (const el of walk(document)) {
        if (el.localName !== 'img' && el.localName !== 'video') continue;
        const r = el.getBoundingClientRect();
        if (r.width > 80 && r.height > 80 && r.top > 120 && r.bottom < innerHeight - 120 &&
            el.checkVisibility({ checkVisibilityCSS: true })) {
            return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), el.localName];
        }
    }
    return null;
"""

REDDIT_PROMPTS = """
    return [...document.querySelectorAll('configured-xpromo-modal:not([data-live-test])')].map(el => el.outerHTML);
"""


class LiveRun:
    def __init__(self, args, out):
        self.args = args
        self.out = out
        self.results = []
        self.temp = tempfile.TemporaryDirectory(prefix="rmu-live-")
        prefs = {} if args.android else {
            "general.useragent.override": MOBILE_UA,
            "dom.w3c_touch_events.enabled": 1,
        }
        android = {"package": args.package, "serial": args.android} if args.android is not None else None
        self.browser = Firefox(out / "geckodriver.log", prefs, headless=not args.headed, android=android)
        if not android:
            self.browser.command("POST", "/window/rect", {"width": 412, "height": 915})

    def close(self):
        self.browser.close()
        self.temp.cleanup()

    def log(self, message):
        print(message, flush=True)

    def load(self, url):
        """Navigate to url; False if Reddit's app did not appear."""
        self.browser.get(url)
        deadline = time.monotonic() + 30
        while not self.browser.js("return Boolean(document.querySelector('shreddit-app'))"):
            if time.monotonic() > deadline:
                return False
            time.sleep(0.5)
        time.sleep(3)
        return True

    def open(self, url):
        # A fresh profile's first visit can be refused ("blocked by network security")
        # while later ones are served normally, so a failed load is retried once.
        loaded = self.load(url) or self.load(url)
        if loaded and self.browser.js(DISMISS_CONSENT):
            # Reddit ships its prompt components only with pages loaded after the
            # consent choice, so the page is loaded again.
            time.sleep(1.5)
            loaded = self.load(url)
        if not loaded:
            self.browser.screenshot(self.out / "not-reddit.png")
            raise RuntimeError(f"{url} did not load Reddit's app (verification page or network block?)")

    def inspect(self):
        return self.browser.js(INSPECT)

    def scroll_gesture(self, point=None):
        """A real input gesture: a touch swipe on Android, wheel input on desktop."""
        before = self.browser.js("return scrollY")
        size = self.browser.js("return [innerWidth, innerHeight]")
        x, y = point or (size[0] // 2, size[1] // 2)
        if self.args.android is not None:
            start, end = y, max(10, y - int(size[1] * 0.4))
            self.browser.actions({"type": "pointer", "id": "finger", "parameters": {"pointerType": "touch"}, "actions": [
                {"type": "pointerMove", "x": x, "y": start, "duration": 0},
                {"type": "pointerDown", "button": 0},
                {"type": "pointerMove", "x": x, "y": end, "duration": 300},
                {"type": "pointerUp", "button": 0},
            ]})
        else:
            self.browser.actions({"type": "wheel", "id": "wheel", "actions": [
                {"type": "scroll", "x": x, "y": y, "deltaX": 0, "deltaY": 700, "duration": 200, "origin": "viewport"},
            ]})
        time.sleep(1)
        return self.browser.js("return scrollY") - before

    def usability(self, name):
        state = self.inspect()
        state["scrolled"] = self.scroll_gesture()
        problems = []
        if state["covering"]:
            problems.append("covered by " + ", ".join(state["covering"]))
        if state["locked"]:
            problems.append("locked: " + ", ".join(state["locked"]))
        if state["visiblePromos"]:
            problems.append("visible promotion: " + ", ".join(state["visiblePromos"]))
        if state["scrolled"] < 100:
            problems.append(f"scroll gesture moved {state['scrolled']}px")
        media = self.browser.js(FIND_MEDIA)
        if media:
            moved = self.scroll_gesture(media[:2])
            state["scrolledFromMedia"] = [media[2], moved]
            if moved < 100:
                problems.append(f"scroll gesture starting on {media[2]} moved {moved}px")
        self.browser.screenshot(self.out / f"{name}.png")
        return state, problems

    def record(self, name, status, detail, state=None):
        self.results.append({"check": name, "status": status, "detail": detail, "state": state})
        self.log(f"  {status:<8} {name}: {detail}")

    def simulate(self, variant, delay=None):
        sheet, dialog_id, dialog_class = VARIANTS[variant]
        result = self.browser.js_async(SIMULATE, sheet, dialog_id, dialog_class,
                                       None if delay is None else delay * 1000)
        if not result["ok"]:
            raise RuntimeError("Reddit's prompt components are unavailable: " + result["error"])
        if delay is None:
            time.sleep(2.5)

    def watch(self, name, seconds, timed, until_opened=False):
        """Poll the page: when Reddit's timer opened the simulated prompt (seconds after
        delivery, or None), and whether Reddit served a prompt of its own."""
        start = time.monotonic()
        opened = None
        served = False
        while time.monotonic() - start < seconds:
            time.sleep(1)
            state = self.inspect()
            if timed and opened is None and state["simulated"] != "waiting":
                opened = round(time.monotonic() - start)
                if until_opened:
                    # Let Reddit finish opening the sheet and locking the page.
                    time.sleep(2)
                    break
            if state["owners"] and not served:
                served = True
                # Reddit's real markup, to keep the timed simulation in line with it.
                markup = "\n".join(self.browser.js(REDDIT_PROMPTS))
                (self.out / f"{name}-reddit-prompt.html").write_text(markup + "\n", encoding="utf-8")
        return opened, served

    def control(self, url):
        self.log("Control without the extension (the simulated prompt must block the page):")
        self.open(url)
        self.simulate("blocking-sheet")
        state, problems = self.usability("control-blocked")
        if problems:
            self.record("control", "OK", "simulated prompt blocks Reddit: " + "; ".join(problems), state)
            return True
        self.record("control", "WARN", "simulated prompt did not block Reddit; simulation may be outdated", state)
        return False

    def control_timed(self, url):
        timer = self.args.timer
        self.log(f"Control without the extension (Reddit's {timer}s timer must block the page):")
        self.open(url)
        state, problems = self.usability("control-timed-before")
        if problems:
            self.record("control-timed", "WARN", "page was not usable before the timer: " + "; ".join(problems), state)
            return
        self.browser.js("window.scrollTo(0, 0)")
        self.simulate("blocking-sheet", delay=timer)
        opened, served = self.watch("control", timer + 15, timed=True, until_opened=True)
        if served:
            self.log(f"  Reddit served a prompt of its own; markup saved to {self.out / 'control-reddit-prompt.html'}")
        if opened is None:
            self.record("control-timed", "WARN", f"Reddit's timer did not open the prompt within {timer + 15}s; "
                        "simulation may be outdated", self.inspect())
            return
        state, problems = self.usability("control-timed-blocked")
        if problems:
            self.record("control-timed", "OK", f"usable at first; Reddit's timer opened the prompt after {opened}s "
                        "and it blocks Reddit: " + "; ".join(problems), state)
        else:
            self.record("control-timed", "WARN", f"prompt opened after {opened}s but did not block Reddit; "
                        "simulation may be outdated", state)

    def timed(self, name):
        """Deliver the timed prompt (if enabled) and watch for Reddit's own meanwhile."""
        timer = self.args.timer
        seconds = max(self.args.wait, timer + 10 if timer else 0)
        self.browser.js("window.scrollTo(0, 0)")
        before = self.inspect()["blocked"]
        if timer:
            self.simulate("blocking-sheet", delay=timer)
        opened, served = self.watch(name, seconds, timed=bool(timer))
        state, problems = self.usability(f"{name}-timed" if timer else f"{name}-natural")
        counted = state["blocked"] - before
        # With the extension each prompt is counted once: anything beyond ours is Reddit's.
        served = served or counted > (1 if opened is not None else 0)
        if timer:
            timed_problems = problems + ([] if counted > 0 else ["prompt was not counted"])
            if opened is None:
                # The extension leaves unopened prompts alone: Reddit's runtime changed.
                self.record(f"{name}-timed", "WARN", f"Reddit's timer did not open the prompt within {seconds}s; "
                            "simulation may be outdated", state)
            elif timed_problems:
                self.record(f"{name}-timed", "FAIL", "; ".join(timed_problems), state)
            else:
                self.record(f"{name}-timed", "PASS", f"Reddit's timer opened the prompt after {opened}s; "
                            f"usable, scrolled {state['scrolled']}px", state)
        if served:
            saved = self.out / f"{name}-reddit-prompt.html"
            where = f"; markup in {saved.name}" if saved.exists() else ""
            if problems:
                self.record(f"{name}-natural", "FAIL", "Reddit served its own prompt: " + "; ".join(problems), state)
            else:
                self.record(f"{name}-natural", "PASS", f"Reddit served its own prompt, blocked{where}", state)
        elif problems and not timer:
            self.record(f"{name}-natural", "FAIL" if state["visiblePromos"] else "WARN", "; ".join(problems), state)
        else:
            self.record(f"{name}-natural", "INFO", f"no prompt served by Reddit in {seconds}s (A/B test)", state)

    def check_page(self, index, url):
        self.log(f"Page {index}: {url}")
        self.open(url)
        state = self.inspect()
        if not state["active"]:
            self.record(f"page{index}-active", "FAIL", "extension is not running on this page", state)
            return
        if self.args.timer or self.args.wait:
            self.timed(f"page{index}")
        for variant in VARIANTS:
            self.open(url)
            before = self.inspect()["blocked"]
            self.simulate(variant)
            state, problems = self.usability(f"page{index}-{variant}")
            if state["blocked"] <= before:
                problems.append("prompt was not counted")
            name = f"page{index}-{variant}"
            if problems:
                self.record(name, "FAIL", "; ".join(problems), state)
            else:
                media = state.get("scrolledFromMedia")
                extra = f", from {media[0]} {media[1]}px" if media else ""
                self.record(name, "PASS", f"usable, scrolled {state['scrolled']}px{extra}", state)

    def run(self):
        self.log(f"Firefox {self.browser.version}; results in {self.out}")
        urls = self.args.url or DEFAULT_URLS
        if not self.args.no_control:
            self.control(urls[0])
            if self.args.timer:
                self.control_timed(urls[0])
        self.browser.install(build(Path(self.temp.name) / "live.xpi"))
        self.log("Extension installed.")
        for index, url in enumerate(urls, 1):
            self.check_page(index, url)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", action="append", help="Reddit page to check (repeatable)")
    parser.add_argument("--wait", type=int, default=40,
                        help="seconds to watch each page for a natural prompt (at least --timer + 10)")
    parser.add_argument("--timer", type=int, default=30,
                        help="seconds before Reddit's timer opens the timed prompt (0 skips)")
    parser.add_argument("--headed", action="store_true", help="show the desktop browser window")
    parser.add_argument("--android", nargs="?", const="", metavar="SERIAL",
                        help="use Firefox on an Android device (optional adb serial)")
    parser.add_argument("--package", default="org.mozilla.firefox", help="Android package name")
    parser.add_argument("--no-control", action="store_true", help="skip the run without the extension")
    parser.add_argument("--out", type=Path, help="directory for screenshots and report.json")
    args = parser.parse_args()
    out = args.out or ROOT / "live-results" / datetime.now().strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    try:
        run = LiveRun(args, out)
    except Exception as error:
        print(f"Could not start Firefox: {error}", file=sys.stderr)
        return 2
    try:
        run.run()
    except RuntimeError as error:
        print(f"Run incomplete: {error}", file=sys.stderr)
        return 2
    finally:
        (out / "report.json").write_text(json.dumps(run.results, indent=2) + "\n", encoding="utf-8")
        run.close()
    failed = [result for result in run.results if result["status"] == "FAIL"]
    print(f"\n{len(run.results)} checks, {len(failed)} failed. Report: {out / 'report.json'}", flush=True)
    if failed:
        return 1
    # A control that does not block, or a timer that never fires, means the simulation
    # no longer matches Reddit: the passing checks prove nothing until it is updated.
    stale = [result["check"] for result in run.results if result["status"] == "WARN"]
    if stale:
        print(f"Inconclusive ({', '.join(stale)}): the simulation may no longer match Reddit.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
