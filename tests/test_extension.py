import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.build import ROOT, EXTENSION_FILES, build
from browser import Firefox


# Representative test strings, not a dictionary used by the extension and not
# a claim about Reddit's exact translations. An unknown locale with empty text
# also checks that neither language detection nor a phrase match is required.
LANGUAGE_CASES = [
    ("en", "ltr", "Get the app to keep using Reddit"),
    ("it", "ltr", "Scarica l’app per continuare a usare Reddit"),
    ("fr", "ltr", "Téléchargez l’application pour continuer à utiliser Reddit"),
    ("de", "ltr", "Lade die App herunter, um Reddit weiter zu nutzen"),
    ("es", "ltr", "Descarga la aplicación para seguir usando Reddit"),
    ("pt-BR", "ltr", "Baixe o aplicativo para continuar usando o Reddit"),
    ("ja", "ltr", "Redditを引き続き利用するにはアプリをダウンロードしてください"),
    ("zh-CN", "ltr", "下载应用以继续使用 Reddit"),
    ("ko", "ltr", "Reddit을 계속 사용하려면 앱을 다운로드하세요"),
    ("hi", "ltr", "Reddit का उपयोग जारी रखने के लिए ऐप डाउनलोड करें"),
    ("ar", "rtl", "نزّل التطبيق لمواصلة استخدام Reddit"),
    ("he", "rtl", "הורידו את האפליקציה כדי להמשיך להשתמש ב-Reddit"),
    ("xx-ZZ", "rtl", ""),
]


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def end_headers(self):
        # Extension code must execute even when Reddit does not permit inline JS.
        self.send_header("Content-Security-Policy", "script-src 'self'; object-src 'none'")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class PackagingTests(unittest.TestCase):
    def test_reproducible_package_and_limited_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            first = build(Path(directory) / "first.xpi")
            second = build(Path(directory) / "second.xpi")
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with ZipFile(first) as archive:
                self.assertEqual(set(archive.namelist()), {*EXTENSION_FILES, "LICENSE"})
                manifest = json.loads(archive.read("manifest.json"))
                popup = archive.read("popup/index.html").decode()
                for name in EXTENSION_FILES:
                    self.assertEqual(archive.read(name), (ROOT / "extension" / name).read_bytes())
                self.assertEqual(archive.read("LICENSE"), (ROOT / "LICENSE").read_bytes())
                for size, name in manifest["icons"].items():
                    data = archive.read(name)
                    self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
                    self.assertEqual(int.from_bytes(data[16:20], "big"), int(size))
                    self.assertEqual(int.from_bytes(data[20:24], "big"), int(size))
            self.assertEqual(manifest["permissions"], ["storage"])
            self.assertEqual(manifest["background"], {"scripts": ["background.js"]})
            self.assertEqual(manifest["name"], "Reddit Mobile Unblocker")
            self.assertEqual(manifest["version"], "1.2.0")
            self.assertEqual(manifest["action"]["default_popup"], "popup/index.html")
            self.assertEqual(manifest["homepage_url"], "https://github.com/fabiomolignoni/RedditMobileUnblocker")
            self.assertIn("https://github.com/fabiomolignoni/RedditMobileUnblocker\"", popup)
            self.assertIn("https://github.com/fabiomolignoni/RedditMobileUnblocker/issues\"", popup)
            self.assertNotIn("ko-fi", popup.lower())
            self.assertEqual(manifest["browser_specific_settings"]["gecko"]["data_collection_permissions"], {"required": ["none"]})
            matches = [
                "https://reddit.com/*", "https://www.reddit.com/*", "https://m.reddit.com/*", "https://sh.reddit.com/*",
            ]
            self.assertEqual([script["matches"] for script in manifest["content_scripts"]], [matches, matches])
            self.assertEqual([script["world"] for script in manifest["content_scripts"]], ["MAIN", "ISOLATED"])


class ExtensionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="rmu-tests-")
        cls.addClassCleanup(cls.temp.cleanup)
        handler = functools.partial(Handler, directory=str(ROOT / "tests" / "fixtures"))
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.addClassCleanup(cls.server.server_close)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.addClassCleanup(cls.server.shutdown)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.browser = Firefox(Path(cls.temp.name) / "geckodriver.log")
        cls.addClassCleanup(cls.browser.close)
        package = build(Path(cls.temp.name) / "test.xpi", "http://127.0.0.1")
        cls.browser.install(package)
        print(f"\nTesting the installed extension in Firefox {cls.browser.version}", flush=True)

    def setUp(self):
        self.browser.get(self.base + "/index.html")
        self.browser.wait("typeof showPromo === 'function' && document.querySelector('main')")

    def show_promo(self, native=False):
        self.browser.js("showPromo('app-upsell-blocking-bottom-sheet-direct', arguments[0])", native)
        self.browser.wait("document.body.style.overflow !== 'hidden' && !document.querySelector('main').inert")

    def canceled(self, target="#text", kind="touchmove"):
        return self.browser.js("""
            const event = new Event(arguments[1], { bubbles: true, cancelable: true, composed: true });
            document.querySelector(arguments[0]).dispatchEvent(event);
            return event.defaultPrevented;
        """, target, kind)

    def test_prevention_runs_before_page_scripts_and_preserves_session(self):
        self.assertTrue(self.browser.js("return Number.isFinite(Date.parse(atFirstPageScript))"))
        self.browser.js("document.cookie='fixture_session=keep-me; path=/'; localStorage.setItem('theme', 'dark');")
        self.browser.get(self.base + "/index.html?reload=1")
        self.assertIn("fixture_session=keep-me", self.browser.js("return document.cookie"))
        self.assertEqual(self.browser.js("return localStorage.getItem('theme')"), "dark")

    def test_popup_hidden_before_frame_and_navigation_restored(self):
        self.show_promo()
        self.browser.wait("frameSawPromo !== null")
        self.assertFalse(self.browser.js("return frameSawPromo"))
        self.assertEqual(self.browser.js("return getComputedStyle(document.body).pointerEvents"), "auto")
        self.assertNotEqual(self.browser.js("return getComputedStyle(document.body).overflowY"), "hidden")
        self.browser.click("#next")
        self.assertEqual(self.browser.js("return location.hash"), "#comments")
        self.assertGreater(self.browser.js("return window.scrollY"), 500)

    def test_status_counts_each_recognized_promotion_once(self):
        self.browser.wait("document.documentElement.getAttribute('data-rmu-active') === 'true'")
        self.assertEqual(self.browser.js("return document.documentElement.getAttribute('data-rmu-prompts-blocked')"), "0")
        self.show_promo()
        self.browser.wait("document.documentElement.getAttribute('data-rmu-prompts-blocked') === '1'")
        self.browser.js("""
            window.firstPromo = document.querySelector('#app-upsell-blocking-bottom-sheet-direct');
            firstPromo.remove(); document.body.append(firstPromo);
        """)
        self.assertEqual(self.browser.js("return document.documentElement.getAttribute('data-rmu-prompts-blocked')"), "1")
        self.browser.js("showPromo('xpromo-bottom-sheet')")
        self.browser.wait("document.documentElement.getAttribute('data-rmu-prompts-blocked') === '2'")

    def blocked_count(self):
        return self.browser.js("return document.documentElement.getAttribute('data-rmu-prompts-blocked')")

    def next_frames(self):
        self.browser.js_async("requestAnimationFrame(() => requestAnimationFrame(arguments[0]))")

    def test_reddit_portal_prompt_hidden_before_frame_and_counted_once(self):
        self.browser.js("showRedditPrompt('app-upsell-blocking-bottom-sheet-direct', "
                        "'configured-xpromo configured-xpromo-bottom-sheet')")
        self.browser.wait("frameSawPromo !== null")
        self.assertFalse(self.browser.js("return frameSawPromo"))
        self.browser.wait("!document.body.classList.contains('rpl-scroll-lock') && "
                          "!document.body.classList.contains('scroll-is-blocked')")
        self.assertFalse(self.canceled())
        self.assertFalse(self.canceled(kind="wheel"))
        # The owner and its portal are one prompt.
        self.assertEqual(self.blocked_count(), "1")

    def test_unrecognized_portal_is_dismissed_through_reddits_own_event(self):
        self.browser.js("showRedditPrompt('xpromo-unrecognized-variant', '')")
        self.browser.wait("!document.querySelector('configured-xpromo-modal') && "
                          "!document.getElementById('xpromo-unrecognized-variant')")
        self.browser.wait("!document.body.classList.contains('rpl-scroll-lock') && "
                          "!document.body.classList.contains('scroll-is-blocked')")
        self.assertFalse(self.canceled())
        self.assertEqual(self.blocked_count(), "1")

    def test_reddit_style_normal_dialog_keeps_its_lock(self):
        self.show_promo()
        self.browser.js("window.consentSheet = showRedditDialog('data-protection-consent-dialog')")
        self.next_frames()
        self.assertTrue(self.browser.js("return document.body.classList.contains('rpl-scroll-lock')"))
        self.assertTrue(self.canceled())
        self.browser.js("consentSheet.hide(); document.body.classList.add('rpl-scroll-lock')")
        self.browser.wait("!document.body.classList.contains('rpl-scroll-lock')")
        self.assertFalse(self.canceled())

    def test_promotion_in_closed_shadow_root_is_hidden_and_unlocks(self):
        self.browser.js("""
            const host = document.createElement('div'); document.body.append(host);
            const root = host.attachShadow({mode: 'closed'});
            root.innerHTML = '<div class="configured-xpromo-full-screen">Get the app</div>';
            window.closedPromo = root.firstElementChild;
            document.body.classList.add('rpl-scroll-lock');
        """)
        # User-origin CSS applies inside closed trees before any script runs.
        self.assertEqual(self.browser.js("return getComputedStyle(closedPromo).display"), "none")
        self.browser.wait("!document.body.classList.contains('rpl-scroll-lock')")
        self.assertEqual(self.blocked_count(), "1")

    def test_scroll_starting_on_media_or_buttons_is_not_frozen(self):
        self.show_promo()
        for target in ("#photo", "#clip", "#vote"):
            with self.subTest(target=target):
                self.assertFalse(self.canceled(target))
                self.assertFalse(self.canceled(target, "wheel"))

    def test_native_promotion_releases_top_layer(self):
        self.show_promo(native=True)
        self.assertFalse(self.browser.js("return document.querySelector('dialog').open"))
        self.browser.click("#next")
        self.assertEqual(self.browser.js("return location.hash"), "#comments")

    def test_nested_shadow_promotion_releases_native_modal(self):
        self.browser.js("""
            const promo = document.createElement('div');
            promo.id = 'xpromo-bottom-sheet'; document.body.append(promo);
            const wrapper = document.createElement('div');
            promo.attachShadow({mode: 'open'}).append(wrapper);
            const dialog = document.createElement('dialog');
            wrapper.attachShadow({mode: 'open'}).append(dialog);
            window.nestedDialog = dialog; dialog.showModal();
        """)
        self.browser.wait("!nestedDialog.open")
        self.browser.click("#next")
        self.assertEqual(self.browser.js("return location.hash"), "#comments")

    def test_reopened_promotional_popover_is_closed(self):
        self.browser.js("""
            const promo = document.createElement('div'); promo.id = 'xpromo-bottom-sheet';
            const popover = document.createElement('div'); popover.popover = 'manual';
            popover.textContent = 'Install'; promo.append(popover); document.body.append(promo);
            window.promoPopover = popover; popover.showPopover();
        """)
        self.browser.wait("!promoPopover.matches(':popover-open')")
        self.browser.js("promoPopover.showPopover()")
        self.browser.wait("!promoPopover.matches(':popover-open')")

    def test_normal_popover_closure_resumes_unlocking(self):
        self.show_promo()
        self.browser.js("""
            const popover = document.createElement('div'); popover.popover = 'manual';
            popover.textContent = 'Share'; document.body.append(popover);
            window.normalPopover = popover; popover.showPopover();
            document.body.style.overflow = 'hidden';
        """)
        self.assertEqual(self.browser.js("return document.body.style.overflow"), "hidden")
        self.assertTrue(self.canceled())
        self.browser.js("normalPopover.hidePopover()")
        self.browser.wait("document.body.style.overflow !== 'hidden'")
        self.assertFalse(self.canceled())

    def test_reconnected_shadow_root_is_observed_again(self):
        self.browser.js("""
            window.detachedHost = document.createElement('div'); document.body.append(detachedHost);
            detachedHost.attachShadow({mode: 'open'}); detachedHost.remove();
        """)
        self.browser.js("document.body.append(detachedHost)")
        self.browser.js("detachedHost.shadowRoot.innerHTML = '<div id=\"xpromo-bottom-sheet\">Install</div>'")
        self.browser.wait("getComputedStyle(detachedHost.shadowRoot.firstElementChild).display === 'none'")

    def test_normal_dialog_keeps_scroll_lock_and_touch_then_restores(self):
        self.show_promo()
        self.browser.js("showNormalDialog()")
        self.assertTrue(self.browser.js("return document.querySelector('#login-dialog').open"))
        self.assertEqual(self.browser.js("return document.body.style.overflow"), "hidden")
        self.assertTrue(self.canceled("#username"))
        self.browser.click("#close")
        self.browser.wait("document.body.style.overflow !== 'hidden'")
        self.assertFalse(self.canceled())

    def test_simultaneous_normal_modal_is_not_unlocked(self):
        self.browser.js("showNormalDialog(); showPromo();")
        self.assertEqual(self.browser.js("return document.body.style.overflow"), "hidden")
        self.assertTrue(self.browser.js("return document.querySelector('#login-dialog').open"))
        self.browser.wait("getComputedStyle(document.querySelector('#login-dialog')).pointerEvents === 'auto'")
        self.browser.click("#close")
        self.browser.wait("!document.querySelector('#login-dialog').open")

    def test_generic_sheet_and_menu_are_preserved(self):
        self.show_promo()
        self.browser.js("""
            const sheet = document.createElement('div');
            sheet.id = 'share-sheet'; sheet.className = 'rpl-bottom-sheet';
            sheet.textContent = 'Share'; document.body.append(sheet);
            document.body.style.overflow = 'hidden';
        """)
        self.assertNotEqual(self.browser.js("return getComputedStyle(document.querySelector('#share-sheet')).display"), "none")
        self.assertEqual(self.browser.js("return document.body.style.overflow"), "hidden")
        self.assertTrue(self.canceled())
        self.browser.js("document.querySelector('#share-sheet').remove()")
        self.browser.wait("document.body.style.overflow !== 'hidden'")

    def test_touch_and_wheel_guard_preserves_media_local_handlers_and_zoom(self):
        self.show_promo()
        self.assertFalse(self.canceled())
        self.assertFalse(self.canceled(kind="wheel"))
        self.assertTrue(self.canceled("#media"))
        self.browser.js("document.querySelector('#text').addEventListener('touchmove', e => e.preventDefault())")
        self.assertTrue(self.canceled())
        self.assertTrue(self.browser.js("""
            const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true });
            document.body.dispatchEvent(e); return e.defaultPrevented;
        """))

    def test_no_promotion_means_no_touch_or_scroll_changes(self):
        self.browser.js("""
            document.body.style.overflow = 'hidden';
            document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
        """)
        self.assertTrue(self.canceled())
        self.assertEqual(self.browser.js("return document.body.style.overflow"), "hidden")

    def test_fixed_body_restores_scroll_and_existing_styles(self):
        self.browser.js("document.body.style.position='relative'; document.body.style.width='95%'; window.scrollTo(0, 400)")
        self.browser.js("""
            const offset = window.scrollY;
            document.body.style.position='fixed'; document.body.style.top=`-${offset}px`;
            document.body.style.width='100%'; showPromo();
        """)
        self.browser.wait("document.body.style.position === 'relative'")
        self.assertEqual(self.browser.js("return document.body.style.width"), "95%")
        self.assertAlmostEqual(self.browser.js("return window.scrollY"), 400, delta=2)

    def test_existing_horizontal_clipping_is_preserved(self):
        self.browser.js("document.body.style.overflowX='hidden'")
        self.show_promo()
        self.assertEqual(self.browser.js("return document.body.style.overflowX"), "hidden")
        self.assertNotEqual(self.browser.js("return getComputedStyle(document.body).overflowY"), "hidden")

    def test_disabled_storage_does_not_disable_dom_protection(self):
        with tempfile.TemporaryDirectory(prefix="rmu-storage-test-") as directory:
            browser = Firefox(Path(directory) / "geckodriver.log", {"dom.storage.enabled": False})
            try:
                browser.install(build(Path(directory) / "test.xpi", "http://127.0.0.1"))
                browser.get(self.base + "/index.html")
                self.assertEqual(browser.js("return atFirstPageScript"), "storage-unavailable")
                browser.js("showPromo()")
                browser.wait("frameSawPromo !== null")
                self.assertFalse(browser.js("return frameSawPromo"))
                self.assertNotEqual(browser.js("return document.body.style.overflow"), "hidden")
            finally:
                browser.close()

    def test_spa_reinsertion_and_late_open_shadow_root(self):
        self.show_promo()
        self.browser.js("""
            document.querySelector('#app-upsell-blocking-bottom-sheet-direct').remove();
            history.pushState({}, '', '/index.html?post=2');
            const host = document.createElement('div'); host.id='shadow-host'; document.body.append(host);
        """)
        self.browser.js("""
            const shadow = document.querySelector('#shadow-host').attachShadow({mode:'open'});
            shadow.innerHTML='<div id="app-upsell-blocking-bottom-sheet-seo">Get the app</div>';
            document.body.classList.add('scroll-is-blocked');
        """)
        self.browser.wait("getComputedStyle(document.querySelector('#shadow-host').shadowRoot.firstElementChild).display === 'none'")
        self.browser.wait("!document.body.classList.contains('scroll-is-blocked')")

    def test_known_variants_and_localized_text(self):
        for selector in ["#app-upsell-blocking-bottom-sheet-seo", "#desktop-dynamic-upsell-dialog",
                         "#xpromo-bottom-sheet", ".configured-xpromo-bottom-sheet", ".configured-xpromo-full-screen",
                         "app-upsell-blocking-bottom-sheet-direct", "app-upsell-blocking-bottom-sheet-seo"]:
            with self.subTest(selector=selector):
                self.browser.js("""
                    const selector = arguments[0];
                    const node = document.createElement(/^[#.]/.test(selector) ? 'div' : selector);
                    if (selector[0] === '#') node.id = selector.slice(1);
                    if (selector[0] === '.') node.className = selector.slice(1);
                    node.textContent = 'アプリをダウンロード'; document.body.append(node);
                """, selector)
                self.browser.wait(f"getComputedStyle(document.querySelector({json.dumps(selector)})).display === 'none'")

    def test_language_independent_popup_and_dialog_handling(self):
        for language, direction, text in LANGUAGE_CASES:
            with self.subTest(language=language):
                # A fresh document prevents rescue state from a previous locale
                # from concealing a language-specific detection failure.
                self.browser.get(self.base + "/index.html?fixtureLanguage=" + language)
                self.browser.js("""
                    document.documentElement.lang = arguments[0];
                    document.documentElement.dir = arguments[1];
                    document.querySelector('#text').textContent = arguments[2];
                    showPromo('app-upsell-blocking-bottom-sheet-direct', true, arguments[2]);
                """, language, direction, text)
                self.browser.wait("frameSawPromo !== null && !document.querySelector('main').inert")
                self.assertFalse(self.browser.js("return frameSawPromo"))
                self.assertFalse(self.browser.js("return document.querySelector('dialog').open"))
                self.assertFalse(self.canceled())
                self.assertNotEqual(self.browser.js("return getComputedStyle(document.body).overflowY"), "hidden")
                self.browser.click("#next")
                self.assertEqual(self.browser.js("return location.hash"), "#comments")
                self.assertGreater(self.browser.js("return window.scrollY"), 500)
                self.assertEqual(self.browser.js("return document.documentElement.lang"), language)
                self.assertEqual(self.browser.js("return document.documentElement.dir"), direction)
                self.assertEqual(self.browser.js("return document.querySelector('#text').textContent"), text)

                # The same words in an ordinary dialog must never classify it
                # as an app promotion, even after a real promo was suppressed.
                self.browser.js("""
                    const dialog = showNormalDialog();
                    dialog.querySelector('label').firstChild.textContent = arguments[0];
                """, text)
                self.assertTrue(self.browser.js("return document.querySelector('#login-dialog').open"))
                self.assertNotEqual(self.browser.js("return getComputedStyle(document.querySelector('#login-dialog')).display"), "none")
                self.assertEqual(self.browser.js("return document.body.style.overflow"), "hidden")
                self.assertTrue(self.canceled("#username"))
                self.browser.click("#close")
                self.browser.wait("document.body.style.overflow !== 'hidden'")

    def test_language_switch_during_navigation(self):
        for language, direction, text in LANGUAGE_CASES:
            with self.subTest(language=language):
                self.browser.js("""
                    document.querySelector('#app-upsell-blocking-bottom-sheet-seo')?.remove();
                    document.documentElement.lang = arguments[0];
                    document.documentElement.dir = arguments[1];
                    history.pushState({}, '', '/index.html?fixtureLanguage=' + arguments[0]);
                    window.frameSawPromo = null;
                    showPromo('app-upsell-blocking-bottom-sheet-seo', false, arguments[2]);
                """, language, direction, text)
                self.browser.wait("frameSawPromo !== null && !document.querySelector('main').inert")
                self.assertFalse(self.browser.js("return frameSawPromo"))
                self.assertFalse(self.canceled())
                self.assertEqual(self.browser.js("return document.documentElement.lang"), language)
                self.assertEqual(self.browser.js("return document.documentElement.dir"), direction)

    def test_unmatched_origin_is_untouched(self):
        self.browser.get(f"http://localhost:{self.server.server_port}/index.html")
        self.assertIsNone(self.browser.js("return document.documentElement.getAttribute('data-rmu-active')"))
        self.browser.js("showPromo()")
        self.browser.wait("frameSawPromo !== null")
        self.assertTrue(self.browser.js("return frameSawPromo"))
        self.assertEqual(self.browser.js("return document.body.style.overflow"), "hidden")

    def test_30_second_timer_and_unrelated_callback(self):
        self.browser.js("""
            window.unrelatedTimerRan = false;
            setTimeout(() => { window.unrelatedTimerRan = true; }, 30000);
            setTimeout(() => showPromo(), 30000);
        """)
        self.browser.wait("unrelatedTimerRan && frameSawPromo !== null", timeout=35)
        self.assertFalse(self.browser.js("return frameSawPromo"))
        self.assertFalse(self.canceled())


if __name__ == "__main__":
    unittest.main()
