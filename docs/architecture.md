# Architecture and shared contract

Seen Before is a plain-JavaScript MV3 extension. `background.js` is the privileged coordinator; `history.js` owns URL normalization and persistence logic; `content.js` detects eligible link navigation and coordinates repeat warnings; popup files provide enablement and history management. `manifest.json` wires the service worker, popup, permissions, and HTTP/HTTPS content scripts. Core and UI file ownership is listed in the root `AGENTS.md`.

## Data and normalization

- Store one `history` object with shape `{ records: { [normalizedURL]: record } }` and a separate `enabled` boolean in extension local storage.
- A record is `{ url, firstClickedAt, lastClickedAt, clickCount }`.
- Normalize parseable HTTP(S) URLs using the platform `URL` parser, remove the fragment, retain the query, and preserve host/trailing-slash distinctions beyond the parser's canonical form. Reject other protocols and invalid URLs.
- Reject URLs with a username or password so credentials are never persisted.
- `CHECK_URL` creates a missing record with count 1, or reports an existing record without changing it. `RECORD_URL` records the confirmed navigation and increments existing counts; a newly seen URL is count 1.
- Serialize mutations in the background to prevent concurrent checks/records from losing updates. Do not silently evict data. Storage failures return a failure response.

## Runtime messages

Every request returns `{ ok: true, ... }` or `{ ok: false, error }`.

| Message | Response / effect | Caller |
| --- | --- | --- |
| `CHECK_URL { url }` | `{ enabled, repeated, record }`; atomically creates a first-seen record. `record` is the record shape above or `null`. | Content script |
| `RECORD_URL { url }` | Records confirmed navigation; increments repeat count. | Content script |
| `GET_STATE` | `{ enabled, records, total }` | Popup |
| `SET_ENABLED { enabled }` | Sets enabled state. | Popup |
| `CLEAR_HISTORY` | Clears all records. | Popup |
| `DELETE_URL { url }` | Removes the normalized URL if present. | Popup |

Content scripts may send only `CHECK_URL` and `RECORD_URL`. Popup actions may use all listed messages. Keep requests and responses JSON-serializable and handle unknown or malformed messages with `{ ok: false, error }`.

## Navigation exclusions and safety

Set manifest `incognito` to `not_allowed`. Ignore same-document fragment-only navigation, downloads, and unsupported protocols. Content scripts asynchronously check an eligible link before it opens. A first-seen link continues by replaying the original link once; a repeat shows an Open anyway/Cancel modal, and only confirmed continuation sends `RECORD_URL`. Preserve left-click, modifier/new-tab, middle-click, keyboard, and SPA navigation behavior. Context-menu and address-bar navigation are outside the warning flow. The extension must not call remote services or inspect pre-install browser history. Use the `storage` permission only; do not add `unlimitedStorage` without a demonstrated need and explicit architecture update.

## Verification target

Tests cover normalization, exclusions, first-seen versus repeated behavior, count updates, concurrent operations, persisted state, and storage failure reporting. Review manifest permissions and search implementation for remote requests when changing runtime behavior.
