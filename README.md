# RedirHub browser extension: Redirect Path & 404 Catcher

A Chrome (Manifest V3) extension in two parts. The checks are free; saving and
exporting need a RedirHub account.

**Redirects.** For the page in the current tab: every hop it went through
(301/302/307/308, Chrome's own HSTS upgrade, meta refresh, JavaScript), each
with its status, server and timing, and the issues worth fixing (a chain of
several hops, a temporary redirect, a client-side redirect, a loop, a drop to
HTTP, an error at the end). The toolbar badge shows the number of redirects,
coloured by the worst issue. **Fix in RedirHub** replaces the chain with one
301 from the first URL to the final page.

**404s.** Every page that answers 404 or 410 while you browse is listed per
site, with where it was linked from and a suggested destination (the most
similar live page seen on the site, else its parent, else the home page).
**Check the links on this page** tests every same-site link on the page.
**Create redirects** saves the selected rows as 301s in RedirHub;
**Export CSV** downloads them for the dashboard's bulk import.

Signing in is an API token from account.redirhub.com, pasted on the
extension's options page. Traces and 404s stay in the browser
(`chrome.storage`); only the rules the user saves are sent, to the RedirHub API
(`POST /v1/links`, handler `redirect`).

## Layout

No build step and no dependencies: Chrome loads the folder as it is.

| Path | What it does |
|---|---|
| `manifest.json` | Permissions: `webRequest`, `webNavigation`, `storage`, all hosts. |
| `src/background.js` | Service worker: builds chains from webRequest/webNavigation, catches 404s, checks links, talks to the API. |
| `src/content.js` | Reports meta refresh tags; collects a page's links for the link check. |
| `src/popup.*`, `src/options.*`, `src/ui.css` | The popup and the settings page. |
| `src/lib/` | Pure logic, unit-tested in `test/` (`npm test`). |
| `e2e/` | A test site and a run that loads the extension in Chromium and screenshots every state. |
| `scripts/`, `store/` | The store ZIP, the store images and the listing text. |

## Try it

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
2. Open any page and click the RedirHub icon.

## End-to-end run

```bash
node e2e/server.mjs &        # acme-shop.test on ports 80/443, plus a stand-in RedirHub API
node e2e/run.mjs /tmp/shots  # Chromium with the extension; prints what each popup said
```

The run resolves `*.test` and `api.redirhub.com` to the local server, so it
never touches the real API. Signing in uses the token `test-token`.

## Publishing

`npm run pack` builds the store ZIP in `dist/`;
`node scripts/store-assets.mjs` takes the five store screenshots in a
real Chrome window on live sites (Apple, HP, redirhub.com; needs Xvfb and
ImageMagick, and `CA_BUNDLE` behind an HTTPS proxy) and draws the promo tile. Listing text, permission justifications, data disclosures and
the privacy policy section are in `store/LISTING.md`. Raise `version` in
`manifest.json` for every upload.

## Before publishing

- The `POST /v1/links` body for a redirect (`url` as `host/path`, `host`) follows
  the OpenAPI document and the MCP `create-redirect` tool; confirm it with the
  API owner against a real workspace.
- A redirect saved for a domain only takes effect once that domain is connected
  to RedirHub; the API error is shown as it comes.
