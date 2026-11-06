# Seen Before

Seen Before is a locally installed Manifest V3 extension for Brave and Chrome. It remembers HTTP(S) links clicked after installation and warns before opening a repeat. Keep behavior local: no cloud, telemetry, remote calls, browser-history access, or build dependencies. Use plain JavaScript and browser extension APIs.

## Boundaries and ownership

- Core developer owns `manifest.json`, `background.js`, `history.js`, `tests/history.test.js`, and `tests/background.test.js`.
- UI developer owns `content.js`, `popup.html`, `popup.css`, `popup.js`, `icons/`, `README.md`, and demo fixtures.
- Shared interfaces, storage shape, exclusions, and behavior are defined in [`docs/architecture.md`](docs/architecture.md). Read it before changing cross-module behavior.
- Keep each feature in its owning module; coordinate changes to message shapes or storage through the architecture note.

## Invariants

- Request only `storage` and the HTTP/HTTPS content-script matches needed by the feature. Do not request browser history permission.
- Accept only `http:` and `https:` URLs. Normalize with `URL`, remove the fragment, retain the query, and do not additionally collapse `www` or trailing slashes.
- Reject URLs containing a username or password; never persist credentials. Ignore same-document fragment jumps, downloads, and unsupported protocols.
- Keep the extension unavailable in incognito (`incognito: "not_allowed"`).
- First checks record the link atomically. A repeat check does not increment its count; increment only after `RECORD_URL`.
- Serialize background mutations. Persist locally under the documented storage schema; do not silently evict records. Surface storage errors as usable failures.
- Content scripts may send only `CHECK_URL` and `RECORD_URL`; popup code may use the privileged state and management messages.
- Link checks are asynchronous and precede opening. New links continue by replaying the original link once; repeats show an Open anyway/Cancel modal. Preserve left, modifier/new-tab, middle, keyboard, and SPA navigation behavior. Context-menu and address-bar navigation are outside the warning flow.

## Validation

Use the repository-local test commands documented in `README.md` once established. Tests should cover URL normalization, exclusions, repeat/count behavior, concurrent writes, persistence, and storage failures. Inspect the manifest and code for remote network access and excess permissions when changing extension capabilities.
