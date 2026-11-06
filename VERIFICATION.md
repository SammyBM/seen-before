# Verification — Seen Before 1.0.0

Verified on November 5, 2026. This folder contains the extension source and tests; installation requires no build or dependency setup.

- 15 unit tests passed for URL matching, repeat counts, concurrent clicks, persistence, enablement, sender authorization, malformed data recovery, and storage failures.
- Source-only core coverage: 93.24% lines and 88.00% branches.
- Browser-measured UI coverage: 88.69% lines. Both UI modules exceed 80% line and branch coverage; see verification/ui-coverage.json.
- 17 end-to-end scenarios passed in Google Chrome 155.0.8059.84 and Chromium 153.0.8010.12, with no unhandled browser errors.
- Runtime permissions: local storage and HTTP/HTTPS content-script access. No browser-history, notification, or network-service permissions. No external runtime requests, analytics, or remote code.
- Brave uses the Chromium extension platform. A separate Brave binary was not available for a native Brave test.

## Browser scenarios

- extension installs and popup starts empty.
- first click navigates and persists one record.
- repeat warns before navigation; Cancel preserves count and focus.
- Open anyway navigates and increments the repeat count.
- fragment variants warn; query variants are distinct.
- same-page anchors and downloads are excluded.
- target blank first and repeat preserve new tabs.
- Ctrl click first and repeat preserve new tabs.
- Shift click first and repeat preserve a separate window.
- middle click first and repeat preserve new tabs.
- keyboard activation and Escape cancellation.
- dynamic links, open shadow roots and frames are tracked.
- SPA click handlers run once with native route behavior.
- paused extension allows repeated links without recording.
- popup history, toggle, remove and clear controls work.
- history survives a full browser restart.
- extension reload fails open on an already-open page.

## Scope

Records real user clicks on ordinary HTTP/HTTPS links after installation. Excludes browser-protected pages, PDFs, downloads, same-page section jumps, script-triggered links, context-menu opens, address-bar and bookmark navigation. Data stays in this browser profile; it is not encrypted or synced. Incognito mode is disabled. See README.md for local installation and behavior details.
