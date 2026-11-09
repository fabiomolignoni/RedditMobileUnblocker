# Reddit Mobile Unblocker

[![Firefox Add-ons](https://img.shields.io/amo/v/reddit-mobile-unblocker?label=Firefox%20Add-ons)](https://addons.mozilla.org/firefox/addon/reddit-mobile-unblocker/)
[![Users](https://img.shields.io/amo/users/reddit-mobile-unblocker)](https://addons.mozilla.org/firefox/addon/reddit-mobile-unblocker/)
[![CI](https://github.com/fabiomolignoni/RedditMobileUnblocker/actions/workflows/ci.yml/badge.svg)](https://github.com/fabiomolignoni/RedditMobileUnblocker/actions/workflows/ci.yml)

A Firefox for Android extension that removes Reddit's “Get the app to keep using
Reddit” prompts and gives back scrolling and taps.

[Install](https://addons.mozilla.org/firefox/addon/reddit-mobile-unblocker/) ·
[Changelog](CHANGELOG.md) ·
[Privacy policy](PRIVACY.md) ·
[Report an issue](https://github.com/fabiomolignoni/RedditMobileUnblocker/issues)

## Features

- Hides Reddit's blocking app prompts (bottom sheets, full-screen sheets and
  dialogs) before they are drawn.
- Restores the scrolling, taps and swipes that a prompt locks.
- Leaves Reddit's ordinary dialogs, such as cookie consent and login, working.
- Works in every language: prompts are recognized by their components, not their text.
- Shows whether the current tab is protected and how many prompts have been blocked.

## Install

Install it in Firefox for Android 144 or later from
[Firefox Add-ons](https://addons.mozilla.org/firefox/addon/reddit-mobile-unblocker/).
If Firefox asks, allow access to Reddit's sites, then reload open Reddit tabs.

## Privacy

The extension collects and transmits no data and makes no network requests of its
own. It runs only on HTTPS pages of `reddit.com`, `www.reddit.com`, `m.reddit.com`
and `sh.reddit.com`; besides access to those sites, its only permission is
`storage`, which keeps the blocked-prompt count on the device. It does not read or
clear cookies, touch logins, or change the user agent. Details are in the
[privacy policy](PRIVACY.md).

## How it works

A page script runs at `document_start` in the page's `MAIN` world, because it has
to wrap the page's own `preventDefault` and `attachShadow` before Reddit's scripts
run; it has no access to extension APIs. It:

1. **Hides** known promotion components by id, element name and class with
   user-origin CSS, which also reaches closed shadow roots.
2. **Dismisses** prompts through Reddit's own `configured-xpromo-modal`, sending it
   the event Reddit uses to close them, so prompts with an unknown identity close too.
3. **Unlocks** the page roots (lock classes, blocking inline styles and `inert`),
   unless an ordinary dialog is open.
4. **Releases gestures** by ignoring `preventDefault()` from page-level
   `touchmove`/`wheel` listeners after a prompt, except on form controls, sliders
   and canvas, for multitouch, and while an ordinary dialog is open.
5. **Sets** Reddit's `localStorage["xpromo-consolidation"]` to the current date, as
   uBlock Origin's filter does. The value stays after uninstalling.

Only inserted or changed elements are inspected, and unlocking runs at most once
per animation frame.

## Limitations

- It relies on Reddit's component names and may need an update when Reddit changes
  them. Reddit tests prompt variants on subsets of users, so not every variant can
  be observed.

## Reporting issues

[Open an issue](https://github.com/fabiomolignoni/RedditMobileUnblocker/issues) with
the Reddit URL, your Firefox and extension versions, whether the popup shows the
tab as protected, and a screenshot of the prompt.

## Development

Requires Node.js 24+, Python 3, and Firefox 144+ with geckodriver, found in `PATH`,
through `FIREFOX_BINARY` and `GECKODRIVER`, or in the Selenium cache.

```sh
npm ci
npm run check     # web-ext lint, unit tests, browser tests on local fixtures
npm run build     # reproducible dist/reddit-mobile-unblocker-<version>-unsigned.xpi
npm run release   # checks, then the package, source archive and checksums for AMO
npm start         # load the extension temporarily in desktop Firefox
```

To run the source on a phone, enable USB debugging and Firefox's “Remote debugging
via USB”, connect it, find its ID with `adb devices`, and run:

```sh
npm run start:android -- --android-device=DEVICE_ID --firefox-apk=org.mozilla.firefox
```

Use `org.mozilla.firefox_beta` for Beta and `org.mozilla.fenix` for Nightly
([Mozilla's guide](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/)).

### Live test

`npm run test:live` checks the extension on real Reddit pages, in Firefox emulating
a phone or, with `--android`, on a connected phone. Reddit's own components open a
prompt, both immediately and through Reddit's 30-second timer: without the
extension the prompt must block the page, with it the page must stay usable.
Screenshots and `report.json` go to `live-results/`. Exit status 2 means the run
could not be performed or was inconclusive, for example because the prompt no
longer blocks Reddit and the simulation needs updating. Run
`npm run test:live -- --help` for details and options.

## AI assistance

The code was written with the help of AI tools. It is checked by the automated
and live tests described above.

## License

[MPL 2.0](LICENSE). Not affiliated with or endorsed by Reddit. Thanks to the
uBlock Origin community, whose
[work on Reddit's prompts](https://github.com/uBlockOrigin/uAssets/issues/32706)
informed this independent implementation, which bundles no filter lists.
