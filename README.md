# Reddit Mobile Unblocker

A Firefox extension for Android and desktop that removes Reddit's mandatory
“Get the app to keep using Reddit” prompts and restores scrolling and taps.
Requires **Firefox 144 or later**. Current source version: **1.3.0**.

[Source code](https://github.com/fabiomolignoni/RedditMobileUnblocker) ·
[Report an issue](https://github.com/fabiomolignoni/RedditMobileUnblocker/issues) ·
Licensed under [MPL 2.0](LICENSE)

The extension does not read or clear cookies, change the user agent, redirect,
or collect and transmit data; logins and preferences are untouched
([privacy policy](PRIVACY.md)). This is not an official Reddit product.

## Try it

The package is **unsigned**, so Firefox stable loads it only temporarily, until
the browser restarts. Permanent installation requires
[signing by Mozilla](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/),
which has not been done.

**Android.** On the computer, install Node.js 24+, Python 3 and the
[Android platform tools](https://developer.android.com/tools/releases/platform-tools)
(`adb`). On the phone, enable USB debugging and, in Firefox settings, “Remote
debugging via USB”. Connect the phone, then run:

```sh
npm ci
adb devices
npm run start:android -- --android-device=DEVICE_ID --firefox-apk=org.mozilla.firefox
```

Grant access to the Reddit domains if prompted and reload open Reddit tabs. Use
`org.mozilla.firefox_beta` for Beta and `org.mozilla.fenix` for Nightly
([Mozilla's guide](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/)).

**Desktop.** Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
Add-on** and select `extension/manifest.json`, or run `npm ci && npm start`.

## How it works

- **Detection** is language-independent: promotions are recognized by component
  identity (ids, element names and classes), never by displayed text. Reddit
  renders its sheets and dialogs as separate “portal” elements carrying the
  promotion's id and classes; user-origin CSS hides them before the first frame
  in every tree, including closed shadow roots.
- **Reddit's own dismissal**: when Reddit's `configured-xpromo-modal` opens a
  prompt, the extension sends it Reddit's dismissal event, which removes the
  prompt and its scroll lock even if the prompt's identity is new.
- **Unlocking**: known lock classes, blocking inline styles (restoring earlier
  values and the scroll position) and `inert` are removed from the page roots
  only. A visible ordinary dialog or menu, such as cookie consent or login,
  suspends unlocking until it closes.
- **Gestures**: after a prompt, `preventDefault()` on `touchmove`/`wheel` is
  ignored for listeners on `window`, `document`, `html` or `body` only, except
  for form controls, sliders, canvas, multitouch, modifier keys and while an
  ordinary dialog is open. Listeners on the page's own elements keep working.
- **Prevention**: Reddit's `localStorage["xpromo-consolidation"]` key is set to
  the current date, in the format used by uBlock Origin's public filter.
- **Performance**: only inserted or changed elements are inspected, and unlocking
  runs at most once per animation frame. Measured on live Reddit (desktop Firefox
  emulating a phone), scrolling showed no measurable main-thread overhead.
- **Popup** (English and Italian): current-tab status and a cumulative count of
  blocked prompts, stored locally in the extension's storage.

The page script runs in the `MAIN` world because it must wrap page-owned
`preventDefault` and `attachShadow`; it has no access to extension APIs. It runs
on `reddit.com`, `www.reddit.com`, `m.reddit.com` and `sh.reddit.com` (HTTPS,
top-level documents only). To disable it, use Firefox's extension manager and
reload Reddit tabs. The date stored in Reddit's `xpromo-consolidation` key stays
there after uninstalling.

## Development

```sh
npm ci
npm run lint
npm test
npm run build   # dist/reddit-mobile-unblocker-1.3.0-unsigned.xpi (reproducible)
```

Tests need **Firefox 144+ and geckodriver** in `PATH`, through `FIREFOX_BINARY` and
`GECKODRIVER`, or in the Selenium cache. Unit tests cover the popup, counter and
selector consistency. Browser tests install the extension in headless Firefox and
check, on local fixtures modeled on Reddit's components, execution before page
scripts, portals, Reddit's dismissal, shadow DOM, native dialogs and popovers,
ordinary dialogs, gestures, layout restoration, SPA navigation, disabled storage,
12 languages (including right-to-left) plus an unknown locale, and excluded origins.

## Live test on reddit.com

`npm run test:live` checks the extension on real Reddit pages in a real Firefox
and writes screenshots and `report.json` to `live-results/`.

- **Simulated prompt**: Reddit's own components open an app prompt on the live
  page, with page-level gesture blockers like Reddit's. A control run without the
  extension first confirms that the prompt blocks the page; with the extension,
  four variants (including an unknown identity) must leave the page usable.
- **Natural prompt**: each page stays open for `--wait` seconds (default 40) for
  Reddit's own timer-based prompt. Reddit shows it only to some sessions, so “not
  served” is information, not a failure.

A page is usable when nothing covers it, its roots are not locked, and real scroll
gestures move it, including one that starts on an image or video. Options:
`--url URL` (repeatable), `--wait SECONDS`, `--headed`, and `--android [SERIAL]`
to run on a USB-connected phone (needs adb, geckodriver 0.36+ and remote debugging).
Exit status is 0 when usable, 1 on failure, and 2 when the run could not be
performed, for example because Reddit showed a verification page.

## Limitations

Protection relies on Reddit's component identities and lock mechanisms and may need
updates when they change; run the live test to check. It does not bypass login
walls, age or NSFW gates, or server-side blocks. Reddit tests prompt variants on
subsets of users, so not every variant can be observed.

## References

- [uAssets issue #32706](https://github.com/uBlockOrigin/uAssets/issues/32706) and
  [public Reddit filters](https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances-others.txt).
- [`$currentDate$` format in uBlock Origin](https://github.com/gorhill/uBlock/blob/master/src/js/resources/localstorage.js).
- [Content scripts and execution worlds](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts).

Independent implementation, without bundled libraries or filter lists.
