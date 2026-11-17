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

**Domains.** A full-page checker for domain portfolios (`src/domains.html`, also from
the popup's Domains tab): paste up to 1,000 domains and each one is requested from the
browser, without cookies, over HTTP and HTTPS. It shows where each domain goes (with
every redirect), whether HTTPS works, and whether it is parked or for sale (Sedo, Dan,
Afternic, HugeDomains, GoDaddy, Atom, ParkingCrew, Bodis and others, by address, then by
the page). A sign-in wall, bot check or rate limit (401, 403, 405, 429, a challenge
page) is "Could not check", never an error. Filters by verdict and HTTPS issues; **Export CSV** and **Forward** (one 301
per selected domain to an address, as whole-domain links in RedirHub) need an account.

**Connecting.** The extension signs in the way MCP clients such as Claude do, with
RedirHub's existing OAuth 2.1 server (redirhub/backend, `app/Mcp/OAuth`): it discovers
the authorization server from the MCP server, registers itself as a public client
once, and opens the consent screen with `chrome.identity.launchWebAuthFlow`
(authorization code with PKCE). The user picks the workspace and allows
`links:read` and `links:write`, nothing more. The access token lasts an hour and is
refreshed with the refresh token; the connection is revoked under the account's
connected apps (AI assistants). Sign-in runs on the options page, which stays open
while the user is on RedirHub.

**Calling RedirHub.** Every call is an MCP tool on the MCP server (`list-links`,
`create-redirect`, `update-link`, `get-account`, `get-workspace`), one JSON-RPC
request each. A rule for a source the workspace already redirects updates that link;
any other is created. The CSV export has the import template's columns
(`source URL,destination,type`). Traces and 404s stay in the browser
(`chrome.storage`); only the rules the user saves or exports leave it.

## Layout

No build step and no dependencies: Chrome loads the folder as it is.

| Path | What it does |
|---|---|
| `manifest.json` | Permissions: `webRequest`, `webNavigation`, `storage`, `identity`, all hosts. |
| `src/background.js` | Service worker: builds chains from webRequest/webNavigation, catches 404s, checks links, calls RedirHub (refreshing the token). |
| `src/connect.js` | The OAuth sign-in, run from the options page. |
| `src/domains.*` | The domain checker page; the requests run in the background script. |
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
`source ../backend/storage/dev-env/env.sh` in the shell. It signs in on RedirHub's
login and consent screen, connects the extension, fixes a chain twice (create, then
update), saves redirects for caught 404s, exports others as a CSV and imports that
CSV in the dashboard, then checks every link, and that the token cannot delete,
through the MCP server. It prints a JSON report and exits 1 when a check fails.
The stand-ins of `run.mjs` (`server.mjs`) do the same OAuth and MCP steps, PKCE and
token refresh included.

## Publishing

`npm run pack` builds the store ZIP in `dist/`;
`node scripts/store-assets.mjs` takes the five store screenshots in a
real Chrome window on live sites (Apple, HP, redirhub.com; needs Xvfb and
ImageMagick, and `CA_BUNDLE` behind an HTTPS proxy) and draws the promo tile. Listing text, permission justifications, data disclosures and
the privacy policy section are in `store/LISTING.md`. Raise `version` in
`manifest.json` for every upload.

## Before publishing

- Once the store gives the extension its id, add `<id>.chromiumapp.org` to the backend's
  `MCP_OAUTH_VERIFIED_HOSTS`, so the consent screen shows it as a verified app instead
  of warning about it.
