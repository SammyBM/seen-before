# Seen Before

Seen Before is a small, local link memory for Brave and Chrome. It remembers HTTP and HTTPS links you click after installing it, then asks before opening one again. It does not read browser history, send data anywhere, or need a build step.

## Install in Brave or Chrome

1. Download or clone the project and locate the extracted `seen-before` folder.
2. Open `brave://extensions` in Brave or `chrome://extensions` in Chrome.
3. Turn on **Developer mode**, choose **Load unpacked**, and select the `seen-before` folder containing `manifest.json`.
4. Pin Seen Before if you want quick access to its popup.

The extension needs local storage to keep your list and access to HTTP/HTTPS pages to notice link clicks before the browser opens them. Browser internal pages, extension stores, and PDF viewer pages do not allow content scripts, so they are outside its reach. After installing or updating, refresh pages that were already open so the content script can start there.

## Try the demo

Start a local web server from the `demo/fixtures` folder, then open `http://localhost:8000/` in the same browser profile where the extension is loaded. For example, from this folder run:

```sh
python3 -m http.server 8000 --directory demo/fixtures
```

Click a link once, then return to the demo and click it again to see the repeat warning. The page also has same-tab and new-tab links, a link added dynamically, a download link, a fragment jump, and a small page script that records click events. Follow the instructions on the page to try keyboard and mouse modifiers and to check that the page receives one click for a first-seen link.

## What gets remembered

- Only HTTP and HTTPS links activated by a real user click are checked. Regular clicks, keyboard activation, Ctrl/Command-click, Shift-click, middle-click, and links with `target="_blank"` are supported. Script-triggered activations such as `link.click()` are not tracked.
- Links containing a username or password are excluded.
- A URL's fragment (`#section`) is ignored when matching; its query string is kept. Host and trailing-slash differences remain distinct.
- The first click creates a record. A repeat warning does not increase its count unless you choose **Open anyway**.
- Same-page fragment navigation, download links, unsupported protocols, right-clicks, address-bar navigation, bookmarks, and context-menu opening are not tracked.
- Seen Before starts with an empty list. It cannot import visits from before installation.
- The list stays in this browser's local extension storage. It is not encrypted, synced, or sent over the network. Clearing a link or the whole list removes it; uninstalling the extension removes its local extension data.

## Development checks

The extension itself needs no installed dependencies. From the folder containing `package.json`, run the local test suite with:

```sh
npm test
```

To run the optional browser checks, install Playwright and its Chromium browser, then run `npm run test:browser`:

```sh
npm install --no-save playwright
npx playwright install chromium
npm run test:browser
```
