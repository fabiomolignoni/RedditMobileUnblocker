# Changelog

## 1.3.0 — faster, sturdier unblocking and live tests

- Rewrite the page script to inspect only inserted or changed elements and to
  unlock at most once per animation frame. On live Reddit this removes up to 2 s
  of main-thread work per 20 s of scrolling and long tasks of up to 80 ms.
- Recognize Reddit's configured promotion portals and close prompts through
  Reddit's own dismissal event, so prompts with a new identity are removed too.
- Keep scrolling when a gesture starts on an image, video or button after a prompt.
- Hide recognized promotions in closed shadow roots; stop writing inline styles.
- Count a prompt once even when Reddit removes it within the same DOM update.
- Localize the popup (English, Italian) and stack its links for long labels.
- Add `npm run test:live` for live Reddit checks, fixtures modeled on Reddit's
  components, GitHub Actions CI, and homepage and repository metadata.

## 1.2.0 — redesigned popup

- Rewrite the toolbar popup from scratch: a single panel with the current-tab
  status and the cumulative total, and project links side by side.
- Mark active protection with the mint check badge from the extension icon,
  and fit the popup to Firefox for Android's full-screen view with larger
  touch targets.
- Remove the Ko-fi support link.
- Point the source code and issue links to
  https://github.com/fabiomolignoni/RedditMobileUnblocker.

## 1.1.0 — cumulative counter and dark popup

- Give the toolbar popup a black background.
- Count recognized app prompts across tabs and browser restarts using local
  extension storage.
- Keep current-tab protection status separate from the cumulative total.

## 1.0.0 — open source release

- Rename the project to Reddit Mobile Unblocker and update package metadata.
- Add a toolbar popup with current-tab activity status and project,
  Issues, and support links.
- Organize extension code into content and popup directories, and remove a
  stale generated archive from source control.
- Keep the existing Firefox add-on ID so installations can update in place.
- Align the source and package license with the repository's MPL 2.0 license.

## 0.1.0 — initial release candidate

- Hide known Reddit app prompts and restore scrolling and interaction without
  clearing cookies or changing the user agent.
- Detect promotions independently of the page language, including components
  in open shadow trees and native dialogs/popovers in nested shadow trees.
- Preserve ordinary dialogs, menus, media controls, local gesture handlers and zoom.
- Refresh Reddit's local promotion timestamp on navigation and tab return.
- Support Firefox 144+ on Android and desktop; provide English and Italian
  descriptions and an original icon.
- Declare no data collection; restrict execution to four Reddit HTTPS origins.
- Include reproducible packaging, release checksums and real Firefox fixture tests.

Live Android acceptance testing and Mozilla signing are tracked separately in
`docs/RELEASE_CHECKLIST.md`; this file does not assert that publication occurred.
