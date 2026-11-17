// Loads the extension in Chromium, browses the test site (server.mjs) and
// saves screenshots of the popup next to the page it describes.
//   node e2e/server.mjs &   (ports 80 and 443)
//   node e2e/run.mjs [outDir]
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");

const extension = resolve(import.meta.dirname, "..");
const out = resolve(process.argv[2] || join(extension, "e2e", "shots"));
mkdirSync(out, { recursive: true });

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "rh-ext-")), {
  channel: "chromium",
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  ignoreHTTPSErrors: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    "--host-resolver-rules=MAP *.test 127.0.0.1, MAP api.redirhub.com 127.0.0.1",
    "--ignore-certificate-errors",
    "--no-proxy-server",
  ],
});

if (!context.serviceWorkers().length) await context.waitForEvent("serviceworker");
const id = new URL(context.serviceWorkers()[0].url()).host;
const base = `chrome-extension://${id}/src`;

const site = await context.newPage();
const pause = (ms) => site.waitForTimeout(ms);

// Chrome replaces the service worker right after installing an extension and
// drops the events in between; a user never browses that fast.
await site.goto(`${base}/options.html`);
await pause(1500);

/** The tab's id, asked from an extension page (the worker may have been replaced). */
async function tabIdOf(url) {
  const page = await context.newPage();
  await page.goto(`${base}/options.html`);
  const tabId = await page.evaluate(async (prefix) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(prefix))?.id, url);
  await page.close();
  return tabId;
}

/** The popup as Chrome shows it, opened under the toolbar icon of a browser window. */
async function frame(name, popupShot, badge) {
  const url = site.url();
  const pageShot = await site.screenshot({ type: "png" });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const img = (buffer) => `data:image/png;base64,${buffer.toString("base64")}`;
  await page.setContent(`<!doctype html><style>
    body{margin:0;font:13px system-ui;background:#dfe3ea}
    .bar{height:60px;background:#f1f3f6;border-bottom:1px solid #d0d5dd;display:flex;align-items:center;gap:12px;padding:0 16px}
    .dots i{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:6px;background:#d0d5dd}
    .url{flex:1;background:#fff;border-radius:18px;padding:8px 16px;color:#344054;border:1px solid #e4e7ec}
    .ext{position:relative;width:32px;height:32px;display:grid;place-items:center;border-radius:8px;background:#e4e7ec}
    .ext img{width:18px;height:18px}
    .badge{position:absolute;right:-6px;bottom:-4px;min-width:16px;padding:0 4px;height:16px;border-radius:4px;color:#fff;font:700 10px/16px system-ui;text-align:center}
    .page{display:block;width:1280px;height:740px;object-fit:cover;object-position:top}
    .popup{position:absolute;top:58px;right:14px;width:440px;height:600px;border-radius:10px;box-shadow:0 18px 50px rgba(16,24,40,.35),0 0 0 1px rgba(16,24,40,.12);overflow:hidden}
  </style><div class="bar"><span class="dots"><i></i><i></i><i></i></span><div class="url">${url}</div>
  <div class="ext"><img src="${img(readFileSync(join(extension, "icons/icon-32.png")))}">${badge.text ? `<span class="badge" style="background:${badge.color}">${badge.text}</span>` : ""}</div></div>
  <img class="page" src="${img(pageShot)}"><img class="popup" src="${img(popupShot)}">`);
  await page.screenshot({ path: join(out, `${name}.png`) });
  await page.close();
}

async function popup(name, { view, before, full } = {}) {
  const tab = await tabIdOf(site.url());
  const page = await context.newPage();
  await page.setViewportSize({ width: 440, height: 600 });
  await page.goto(`${base}/popup.html?tab=${tab}${view ? `&view=${view}` : ""}`);
  await page.waitForSelector("#view-chain > *", { state: "attached" });
  if (before) await before(page);
  await page.waitForTimeout(300);
  const badge = await page.evaluate(async (tabId) => {
    const [r, g, b] = await chrome.action.getBadgeBackgroundColor({ tabId });
    return { text: await chrome.action.getBadgeText({ tabId }), color: `rgb(${r},${g},${b})` };
  }, tab);
  await frame(name, await page.screenshot(), badge);
  if (full) {
    await page.addStyleTag({ content: "body{height:auto;overflow:visible} main{overflow:visible}" });
    await page.setViewportSize({ width: 440, height: await page.evaluate(() => document.body.scrollHeight) });
    await page.screenshot({ path: join(out, `${name}-full.png`), fullPage: true });
  }
  const text = await page.locator("main").innerText();
  await page.close();
  await site.bringToFront();
  return text;
}

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

// 7. Connect an account on the options page (the API is the stand-in in server.mjs).
const options = await context.newPage();
await options.setViewportSize({ width: 900, height: 760 });
await options.goto(`${base}/options.html`);
await options.fill("#token", "wrong-token");
await options.click("button[type=submit]");
await options.waitForSelector("#error:not([hidden])");
report.badToken = await options.locator("#error").innerText();
await options.fill("#token", "test-token");
await options.click("button[type=submit]");
await options.waitForSelector("#connected:not([hidden])");
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
