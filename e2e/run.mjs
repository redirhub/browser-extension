// Loads the extension in Chromium, browses the test site (server.mjs) and
// saves screenshots of the popup next to the page it describes.
//   node e2e/server.mjs &
//   node e2e/run.mjs [outDir]
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildExtension } from "./build.mjs";
import { extensionSession } from "./session.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");

const root = resolve(import.meta.dirname, "..");
const out = resolve(process.argv[2] || join(root, "e2e", "shots"));
mkdirSync(out, { recursive: true });
const PORT = Number(process.env.E2E_PORT || 8443);
const extension = buildExtension({
  MCP_URL: "https://api.test/",
  DASHBOARD_URL: "https://dashboard.test",
  URL_CONNECTIONS: "https://account.test/mcp",
});

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "rh-ext-")), {
  channel: "chromium",
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  ignoreHTTPSErrors: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    `--host-resolver-rules=MAP *.test 127.0.0.1:${PORT}`,
    "--ignore-certificate-errors",
    "--no-proxy-server",
  ],
});

const { base, site, pause, popup } = await extensionSession(context, out);

const report = {};

// 1. A four-hop chain: 301, 302, 301 and a meta refresh.
await site.goto("http://acme-shop.test/summer-sale");
await site.waitForURL("**/sale/summer-2026");
await pause(500);
report.chain = await popup("1-chain", { full: true });

// 2. A JavaScript redirect.
await site.goto("https://www.acme-shop.test/go/promo");
await site.waitForURL("**/sale/summer-2026");
await pause(500);
report.js = await popup("2-js");

// 3. A clean single 301.
await site.goto("http://www.acme-shop.test/pricing");
await pause(300);
report.clean = await popup("3-clean");

// 4. Browse the site; two visits hit 404s.
for (const path of ["/", "/products/", "/products/blue-widget", "/products/red-widget", "/about", "/contact", "/blog/how-to-fix-redirect-chains"]) {
  await site.goto(`https://www.acme-shop.test${path}`);
}
await site.goto("https://www.acme-shop.test/products/");
await site.evaluate(() => { location.href = "/products/blue-widgets"; });
await site.waitForURL("**/blue-widgets");
await site.goto("https://www.acme-shop.test/summer-deals");
await pause(300);
report.visit404 = await popup("4-404-page");

// 5. The blog page: check its links, then the 404 list, signed out.
await site.goto("https://www.acme-shop.test/blog/");
await pause(300);
report.scan = await popup("5-404-list", {
  view: "404",
  full: true,
  before: async (page) => {
    await page.click("#scan");
    await page.waitForSelector(".scan-result");
  },
});

// 6. The sign-in gate on "Create redirects".
report.gate = await popup("6-gate", { view: "404", before: (page) => page.click(".footer .btn.primary") });

// 7. Connect an account: Chrome's sign-in window shows the consent screen; Allow hands back a code.
const options = await context.newPage();
await options.setViewportSize({ width: 900, height: 760 });
await options.goto(`${base}/options.html`);
const signIn = context.waitForEvent("page");
await options.click("#connect-button");
const consent = await signIn;
await consent.waitForSelector("#allow");
report.consent = await consent.locator("h1").innerText();
await consent.click("#allow");
await options.waitForSelector("#connected:not([hidden])");
report.connected = await options.locator("#connected").innerText();
await options.screenshot({ path: join(out, "7-options.png") });
await options.close();

// 8. Signed in: fix the chain, then create the 404 redirects.
await site.goto("http://acme-shop.test/summer-sale");
await site.waitForURL("**/sale/summer-2026");
await pause(500);
report.fix = await popup("8-fixed-chain", {
  before: async (page) => {
    await page.click(".actions .btn.primary");
    await page.waitForSelector(".toast:not([hidden])");
  },
});
// The access token expires: saving refreshes it first (the stand-in retires the old one).
const page = await context.newPage();
await page.goto(`${base}/options.html`);
await page.evaluate(async () => {
  const { auth } = await chrome.storage.local.get("auth");
  await chrome.storage.local.set({ auth: { ...auth, tokens: { ...auth.tokens, expiresAt: 0 } } });
});
await page.close();
await site.goto("https://www.acme-shop.test/blog/");
await pause(300);
report.imported = await popup("9-imported", {
  view: "404",
  before: async (page) => {
    await page.click(".footer .btn.primary");
    await page.waitForSelector(".toast:not([hidden])");
  },
});

console.log(JSON.stringify(report, null, 2));
await context.close();
