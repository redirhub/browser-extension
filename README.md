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

**Connecting.** Connect RedirHub opens the dashboard's `/connect/extension` page
(redirhub/lviv) with a one-time state. The user signs in there if needed, checks the
workspace and clicks Connect; the dashboard creates an API token for the extension
(`POST v0.1.3/account/tokens`, redirhub/backend) and posts it to the extension's
content script with the state. The token never goes in a URL, and is revoked under
API tokens like any other. Traces and 404s stay in the browser (`chrome.storage`);
only the rules the user saves or exports leave it, to the RedirHub API.

**Saving.** A rule for a source the workspace already redirects updates that link
(`PUT /v1/links/{id}`); any other is created (`POST /v1/links`, handler `redirect`,
the source URL carrying its host). The CSV export has the import template's columns
(`source URL,destination,type`).

## Layout

No build step and no dependencies: Chrome loads the folder as it is.

| Path | What it does |
|---|---|
| `manifest.json` | Permissions: `webRequest`, `webNavigation`, `storage`, all hosts. |
| `src/background.js` | Service worker: builds chains from webRequest/webNavigation, catches 404s, checks links, talks to the API. |
| `src/content.js` | Reports meta refresh tags; collects a page's links for the link check. |
| `src/popup.*`, `src/options.*`, `src/ui.css` | The popup and the settings page. |
| `src/lib/` | Pure logic, unit-tested in `test/` (`npm test`). |
| `e2e/` | A test site with stand-ins, `run.mjs` (every popup state) and `live.mjs` (a real backend and dashboard). |
| `scripts/`, `store/` | The store ZIP, the store images and the listing text. |

## Try it

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
2. Open any page and click the RedirHub icon.

## End-to-end runs

```bash
node e2e/server.mjs &     # the test site on one port (8443) for HTTP and HTTPS, with stand-ins
                          # for the API and the dashboard's connect page
node e2e/run.mjs /tmp/shots    # every popup state, against the stand-ins
node e2e/live.mjs /tmp/live    # against a real backend and dashboard (below)
```

`live.mjs` needs redirhub/backend's local copy with the dashboard,
`.claude/dev-serve.sh --dashboard` (with redirhub/lviv next to it), and
`source ../backend/storage/dev-env/env.sh` in the shell. It signs in to the
dashboard, connects the extension, fixes a chain twice (create, then update), saves
redirects for caught 404s, exports others as a CSV and imports that CSV in the
dashboard, then checks every link through the API. It prints a JSON report and
exits 1 when a check fails.

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
