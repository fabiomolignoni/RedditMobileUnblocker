# Reddit Mobile Unblocker

A Firefox extension for Android and desktop that suppresses the mandatory
“Get the app to keep using Reddit” prompt and restores browsing.
Requires **Firefox 144 or later**. Current source version: **1.1.0**.

[Source code](https://github.com/silentfoxdev/RedditMobileUnblocker) ·
[Report an issue](https://github.com/silentfoxdev/RedditMobileUnblocker/issues) ·
[Support the project ☕](https://ko-fi.com/silentfoxdev/donate)

Licensed under [MPL 2.0](LICENSE).

The extension does not read or clear cookies, change the user agent, or redirect
to other sites. It does not collect or transmit data. Login sessions and
preferences are not reset. This is not an official Reddit product.

## Try it on Firefox for Android

The generated package is **unsigned**: opening it directly will not install it
permanently in Firefox stable. You can try it using temporary development loading:

1. On your computer, install Node.js 24 or later, Python 3, and the
   [Android Platform Tools](https://developer.android.com/tools/releases/platform-tools)
   with `adb` in your `PATH`.
2. On your phone, enable Android USB debugging and remote debugging via USB in
   Firefox settings. Connect the phone to your computer and authorize the connection.
3. Run these commands in the project directory:

   ```sh
   npm ci
   adb devices
   npm run start:android -- --android-device=DEVICE_ID --firefox-apk=org.mozilla.firefox
   ```

4. Open Firefox on your phone, grant access to the Reddit domains if prompted,
   and **reload any Reddit tabs that are already open**. The extension works automatically.

Use the device identifier returned by `adb devices`. The APK name for Firefox Beta
is `org.mozilla.firefox_beta`; for Nightly, it is `org.mozilla.fenix`.
Loading is temporary and must be repeated after restarting the browser.
See also [Mozilla’s Android instructions](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/).

Permanent installation requires submitting the package to Mozilla for signing,
either for publication on AMO or for self-distribution. This repository contains
no publishing credentials, and the package has not been submitted to Mozilla.
[Signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

## Try it on Firefox desktop

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**,
and select `extension/manifest.json`. Reload Reddit.
Alternatively, with Firefox in your `PATH`:

```sh
npm ci
npm start
```

## How it works

Detection is **language-independent**. The extension identifies app-promotion
components by their IDs, custom element names, and classes, not by the displayed
message. No language setting or translation dictionary is needed. English is used
for this project's documentation and extension description; it does not restrict
the languages in which Reddit can be used or change Reddit's language.

This also applies to right-to-left pages and language changes during navigation.
The tests cover 12 representative languages, plus an unknown language tag with
an empty prompt. They verify that ordinary content and dialogs containing the
same words remain available. These are local fixture checks: support across
languages depends on Reddit retaining the recognized component structure, and
does not imply that every regional frontend variant has been tested live.

- **Prevention:** at `document_start`, sets only the site’s
  `localStorage["xpromo-consolidation"]` key to the current date, using
  `new Date().toString()`. It also refreshes the value when returning to the page
  or tab, at most once per minute, without periodic timers. This is the format
  used by the public uBlock Origin filter; its effectiveness for each Reddit
  experiment has not been verified. Protection continues if storage is unavailable.
- **Popups:** CSS loaded before the scripts hides specific app-prompt identifiers.
  An observer handles reinsertion, dynamic navigation, and components in open
  Shadow DOM trees. Native promotional dialogs are also closed to release the
  browser’s implicit interaction lock.
- **Scrolling and clicks:** after identifying a promotion, removes known lock
  classes from page roots and restores blocking inline styles, recovering
  previous values and the scroll position where possible. Restores `inert`
  only on the expected roots when a non-inert baseline exists, or on `html`/`body`.
- **Touch:** an intervention in the page’s JavaScript context suppresses
  `preventDefault()` on `touchmove`/`wheel` only after a promotion has been
  identified, and only in listeners on `window`, `document`, `html`, or `body`.
  Controls, media, multitouch gestures, and modifier keys are excluded.
  Local listeners continue to work. Listeners and timers are not globally disabled.
- **Normal dialogs:** a visible menu or dialog suspends scroll and touch unlocking.
  If it inherits the promotion’s click lock, the dialog receives a temporary
  `pointer-events` correction while keeping the background locked.

The content script runs in the `MAIN` world to intercept page methods.
It contains no privileged APIs. A separate isolated content script reads
local status markers and forwards newly blocked, recognized app prompts to a
background script. The background script keeps one cumulative total in the
extension's local storage, across pages, tabs, and browser restarts. The popup
shows that total and whether protection is running in the current tab. On other
pages it shows that protection is inactive while retaining the total. No browsing
history or status is sent outside the browser. An existing installation cannot
reconstruct blocks from before this counter was introduced.
The minimum version of 144 allows CSS with the `user` origin, which takes
precedence over the site’s inline `!important` styles. The background script is
an event page and requires no runtime dependencies.

The only allowed domains are `reddit.com`, `www.reddit.com`, `m.reddit.com`,
and `sh.reddit.com`, over HTTPS and in the top-level document.
`old.reddit.com`, chat on other subdomains, and iframes are excluded.

To disable it, use Firefox’s extension manager and reload your Reddit tabs:
JavaScript changes to already-open pages end when those pages are reloaded.
The promotional date saved by the site remains; session cookies are not modified.
Uninstalling does not restore the previous value of that key.

## Development and verification

```sh
npm ci
npm run lint
npm test
npm run build
```

The build uses only Python’s standard library and generates a reproducible archive:

```text
dist/reddit-mobile-unblocker-1.1.0-unsigned.xpi
```

The package contains only the files selected by `scripts/build.py` plus the license.
`npm ci` is needed for Mozilla’s validator and `web-ext run`; the build and tests
require no additional Python packages or JavaScript libraries.

Tests require **Firefox 144+ and geckodriver**, either in your `PATH` or specified
through `FIREFOX_BINARY` and `GECKODRIVER`. The standard Selenium cache is also
supported. For example:

```sh
FIREFOX_BINARY=/path/to/firefox GECKODRIVER=/path/to/geckodriver npm test
```

The tests install the temporary XPI in a real headless Firefox instance with a
separate profile. Only the temporary manifest copy allows the fixtures’ local
origin; the distributable package remains restricted to Reddit. Tests use local
sockets and also verify a page with a restrictive Content Security Policy.

Coverage includes execution before site scripts, cookies and preferences, a real
30-second delay, link clicks, scrolling, the dialog top layer, concurrent dialogs,
generic panels, media gestures, layout restoration, dynamic navigation, open
Shadow DOM, disabled storage, and no execution on excluded origins. Multilingual
cases cover English, Italian, French, German, Spanish, Brazilian Portuguese,
Japanese, Chinese, Korean, Hindi, Arabic, and Hebrew, as well as an unknown locale.
Synthetic touch events verify `preventDefault` handling, not the physics of
scrolling on a phone.

## Limitations and device testing

The fixtures verify known mechanisms, not every variant of the site.
During development, requests from the server to Reddit returned a verification
page: **live Reddit and Android testing was not performed in that environment**.

Before distribution, test with the Android profile where the block occurs:

- Browse while logged out and logged in for several minutes, across repeated visits and a restart.
- Open posts, comments, and search; navigate back and forward; return to a suspended tab.
- Check login, voting, posting comments, sharing menus, and consent dialogs.
- Check videos, galleries, zoom, orientation changes, and desktop site mode.

Protection relies on frontend signatures and may require updates if Reddit
changes its markup or event handling. It does not hide unknown panels based
only on their text, or bypass login requirements or server-side blocking responses.
Content that the server does not provide cannot be restored.
Unknown panels inside closed Shadow DOM trees cannot be inspected; a recognized
promotional host can still be hidden.

Distinguishing promotional locks from normal dialogs necessarily relies on
observable components: compatibility with future Reddit components or custom
gestures cannot be guaranteed. If a regression occurs, disable the add-on,
reload, and compare the same navigation steps.

## Technical references

- [uAssets issue #32706](https://github.com/uBlockOrigin/uAssets/issues/32706).
- [Firefox Android issue #33373](https://github.com/uBlockOrigin/uAssets/issues/33373).
- [Public xpromo-consolidation rule](https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances-others.txt).
- [$currentDate$ format in the uBlock Origin source](https://github.com/gorhill/uBlock/blob/master/src/js/resources/localstorage.js).
- [Content scripts and execution worlds](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts).

Independent implementation, without bundling external libraries or filter lists.
