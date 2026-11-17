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
npm run e2e       # needs `node e2e/server.mjs` running (ports 80/443): Chromium with the extension
```

Every behaviour change comes with a unit test (pure logic in `src/lib/`) or an e2e step.

## Layout

- `src/background.js`: the service worker. Builds redirect chains from `webRequest` and
  `webNavigation`, catches 404s, runs the link check, talks to the API. Keep listeners at top
  level (MV3 wakes the worker for them).
- `src/content.js`: classic script on every page; reports meta refresh tags and collects links.
- `src/popup.*`, `src/options.*`, `src/ui.css`: the UI. Icons are line SVGs from
  `src/lib/icons.js`; no emoji in the UI.
- `src/lib/`: pure logic (chain analysis, 404 suggestions, rules, API client).
- `e2e/`: a local test site with a stand-in API, and a run that screenshots every state.
- `scripts/`: the store ZIP (`npm run pack`) and the store images (`store-assets.mjs`, a real
  Chrome window on live sites).
- `store/`: the listing text, permission justifications and store images.

## Rules

- **Privacy.** Traces and caught 404s stay in `chrome.storage`. Nothing leaves the browser
  except what the user saves or exports, and only to the RedirHub API. Keep the store
  disclosures in `store/LISTING.md` true when this changes.
- **Requests carry the user's cookies.** The link check never requests sign-out or download
  links; anything new that fetches a page must think about side effects the same way.
- **Only 404 and 410 are "missing".** Login walls and bot checks (403, 405, …) are reported as
  "could not be checked", never as broken.
- **API.** The public RedirHub API (`https://api.redirhub.com/v1`, bearer token), as its
  OpenAPI document describes it. Do not invent request or response shapes.
- **Copy** follows RedirHub's product facts: plans are Core, Pro and Enterprise (no free plan),
  "130 Global PoPs", "99.99% platform uptime" (never an SLA).
- **Version.** Raise `version` in `manifest.json` for every store upload.
