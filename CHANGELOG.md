# Changelog

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
