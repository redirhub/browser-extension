# AGENTS.md

Guidance for coding agents (and people) working on the RedirHub browser extension
(Redirect Path & 404 Catcher, Chrome Manifest V3).

## Keep it lean

Plain ES modules, no build step and no runtime dependencies: Chrome loads this folder as it
is. One way to do each thing; when something is replaced, change every caller and delete the
old path. No compatibility shims, fallbacks or "just in case" code paths.

## Before you finish

```bash
npm test          # unit tests of src/lib (node:test, no dependencies)
npm run e2e       # needs `node e2e/server.mjs` running: every popup state, against stand-ins
node e2e/live.mjs # against a real local backend and dashboard (README, End-to-end runs)
```

A change to how the extension talks to RedirHub (connecting, saving, exporting) runs
`e2e/live.mjs` too: the stand-ins only know what the real API was seen to do.

Every behaviour change comes with a unit test (pure logic in `src/lib/`) or an e2e step.

## Layout

- `src/background.js`: the service worker. Builds redirect chains from `webRequest` and
  `webNavigation`, catches 404s, runs the link check, calls RedirHub's MCP tools. Keep listeners at top
  level (MV3 wakes the worker for them).
- `src/content.js`: classic script on every page; reports meta refresh tags and collects links.
- `src/popup.*`, `src/options.*`, `src/ui.css`: the UI. Icons are line SVGs from
  `src/lib/icons.js`; no emoji in the UI.
- `src/connect.js`: the OAuth sign-in, run from the options page (it stays open meanwhile).
- `src/domains.*`: the domain checker page; `src/lib/domains.js` holds its logic (list parsing,
  parking and for-sale detection, verdicts) and the background script makes the requests.
- `src/lib/`: chain analysis, 404 suggestions, domain verdicts, rules, OAuth and MCP helpers,
  shared DOM helpers (`dom.js`) and the sign-in prompt (`gate.js`).
- `e2e/`: a local test site with a stand-in API, and a run that screenshots every state.
- `scripts/`: the store ZIP (`npm run pack`) and the store images (`store-assets.mjs`, a real
  Chrome window on live sites).
- `store/`: the listing text, permission justifications and store images.

## Rules

- **Privacy.** Traces and caught 404s stay in `chrome.storage`. Nothing leaves the browser
  except what the user saves or exports, and only to the RedirHub API. Keep the store
  disclosures in `store/LISTING.md` true when this changes.
- **Requests carry the user's cookies.** The link check never requests sign-out or download
  links; anything new that fetches a page must think about side effects the same way. The
  domain checker sends no cookies at all (`credentials: "omit"`).
- **Parking and sales services are named only on evidence:** the final address or a script or
  phrase in the page (`src/lib/domains.js`). A new provider comes with a unit test.
- **Only 404 and 410 are "missing".** Login walls, bot checks and rate limits (401, 403, 405,
  429, a challenge page's 503) are reported as "could not be checked", never as broken: in the
  link check, and in the domain checker as "Could not check" (`blockedReason` in
  `src/lib/domains.js`). A real server error stays an error.
- **RedirHub, through MCP and OAuth only.** The extension signs in with RedirHub's OAuth
  server (PKCE, refresh tokens, scopes `links:read` and `links:write`) and calls MCP tools.
  No API tokens, no second sign-in path, no extra scopes without a feature that needs them.
  Do not invent tool arguments or results: check them against a real backend
  (`e2e/live.mjs`), and keep the stand-ins in `e2e/server.mjs` to what the real server does.
- **Addresses** live in `src/lib/config.js` only (the MCP server; the sign-in is discovered
  from it); the e2e runs replace that file in a copy.
- **Copy** follows RedirHub's product facts: plans are Core, Pro and Enterprise (no free plan),
  "130 Global PoPs", "99.99% platform uptime" (never an SLA).
- **Version.** Raise `version` in `manifest.json` for every store upload.
