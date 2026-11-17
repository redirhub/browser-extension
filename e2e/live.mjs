// The extension against a real RedirHub: the backend and the dashboard served locally by
// redirhub/backend's `.claude/dev-serve.sh --dashboard` (https://api.redirhub.test,
// https://app.redirhub.test, demo data), and the test site of server.mjs for pages to browse.
//
//   (cd ../backend && .claude/dev-serve.sh --dashboard)
//   node e2e/server.mjs &
//   node e2e/live.mjs [outDir]
//
// It connects the extension through the dashboard (signing in there first), fixes a redirect
// chain, creates redirects for caught 404s, exports others as a CSV and imports that CSV in the
// dashboard, then checks every link through the API. Prints a JSON report; exits 1 on a failure.
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildExtension } from "./build.mjs";
import { extensionSession } from "./session.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");

const root = resolve(import.meta.dirname, "..");
const out = resolve(process.argv[2] || join(root, "e2e", "shots-live"));
mkdirSync(out, { recursive: true });
const PORT = Number(process.env.E2E_PORT || 8443);
const API = "https://api.redirhub.test/v1";
const DASHBOARD = "https://app.redirhub.test";
const LOGIN = { email: process.env.E2E_EMAIL || "demo@redirhub.com", password: process.env.E2E_PASSWORD || "redirhub123" };
const RUN = Date.now().toString(36);

const extension = buildExtension({
  API_BASE: API,
  DASHBOARD_URL: DASHBOARD,
  URL_API_TOKENS: "https://service.redirhub.test/user/api-tokens",
});

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "rh-live-")), {
  channel: "chromium",
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  ignoreHTTPSErrors: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    // The test site; *.redirhub.test resolves to this machine through /etc/hosts.
    `--host-resolver-rules=MAP *.acme-shop.test 127.0.0.1:${PORT}, MAP acme-shop.test 127.0.0.1:${PORT}`,
    // The test site's certificate is self-signed; the extension's own requests check it too.
    "--ignore-certificate-errors",
    "--no-proxy-server",
  ],
});

const { base, site, pause, popup } = await extensionSession(context, out);
const report = { run: RUN, steps: {} };
const failures = [];
const check = (name, ok, detail) => {
  report.steps[name] = { ok, ...(detail === undefined ? {} : { detail }) };
  if (!ok) failures.push(name);
};

// ---------- 1. connect through the dashboard, signing in on the way ----------

const options = await context.newPage();
await options.setViewportSize({ width: 900, height: 760 });
await options.goto(`${base}/options.html`);
const opened = context.waitForEvent("page");
await options.click("#connect-button");
const dashboard = await opened;
await dashboard.setViewportSize({ width: 1280, height: 800 });
await dashboard.waitForURL("**/login**");
check("connect page asks to sign in first", dashboard.url().includes("redirect=%2Fconnect%2Fextension"), dashboard.url());
// The login page signs in with an emailed code by default; `method=password` asks for the password.
await dashboard.goto(`${dashboard.url()}&method=password`);
await dashboard.fill("input[name=email]", LOGIN.email);
await dashboard.fill("input[name=password]", LOGIN.password);
await dashboard.getByRole("button", { name: "Log in", exact: true }).click();
await dashboard.waitForURL("**/connect/extension?state=*");
await dashboard.waitForSelector("[data-testid=connect-allow]:not([disabled])");
await dashboard.screenshot({ path: join(out, "1-dashboard-consent.png") });
await dashboard.click("[data-testid=connect-allow]");
await dashboard.waitForSelector("[data-testid=connect-done]");
check("dashboard says connected", true, await dashboard.locator("[data-testid=connect-done]").innerText());
await dashboard.screenshot({ path: join(out, "2-dashboard-connected.png") });
await dashboard.close();

await options.waitForSelector("#connected:not([hidden])");
check("extension shows the account", true, (await options.locator("#email").innerText()).trim());
await options.screenshot({ path: join(out, "3-extension-connected.png") });
const token = await options.evaluate(async () => (await chrome.storage.local.get("auth")).auth.token);
await options.close();

/** GET from the API with the token the dashboard gave the extension. */
const api = async (path) => {
  const response = await fetch(API + path, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const findLink = async (source) => {
  const { body } = await api(`/links?filter[search]=${encodeURIComponent(source)}&per_page=50`);
  return (body?.data || []).find((link) => link.url === source) || null;
};
check("token works on the API", (await api("/account")).status === 200);

// ---------- 2. fix a redirect chain ----------

await site.goto("http://acme-shop.test/summer-sale");
await site.waitForURL("**/sale/summer-2026");
await pause(500);
let toast = "";
await popup("4-fix-chain", {
  before: async (page) => {
    await page.click(".actions .btn.primary");
    await page.waitForSelector(".toast.success:not([hidden])");
    toast = await page.locator(".toast").innerText();
  },
});
check("popup reports the chain saved", /^(Saved|Updated): http:\/\/acme-shop\.test\/summer-sale/.test(toast), toast);
// Fixing again finds the redirect it saved and updates it instead of failing on a duplicate.
await popup("4b-fix-chain-again", {
  before: async (page) => {
    await page.click(".actions .btn.primary");
    await page.waitForSelector(".toast.success:not([hidden])");
    toast = await page.locator(".toast").innerText();
  },
});
check("fixing again updates the existing redirect", toast.startsWith("Updated: http://acme-shop.test/summer-sale"), toast);
const chainLink = await findLink("acme-shop.test/summer-sale");
check("the chain's redirect exists", chainLink?.destination === "https://www.acme-shop.test/sale/summer-2026" && chainLink?.type === "301",
  chainLink && { id: chainLink.id, destination: chainLink.destination, type: chainLink.type, note: chainLink.note });

// ---------- 3. create redirects for caught 404s ----------

for (const path of ["/", "/products/", "/products/blue-widget", "/about", "/contact", "/blog/how-to-fix-redirect-chains"]) {
  await site.goto(`https://www.acme-shop.test${path}`);
}
await site.goto("https://www.acme-shop.test/blog/");
await pause(300);
await popup("5-create-404s", {
  view: "404",
  before: async (page) => {
    await page.click("#scan");
    await page.waitForSelector(".scan-result");
    report.scan = await page.locator(".scan-result").innerText();
    await page.click(".footer .btn.primary");
    await page.waitForSelector(".toast.success:not([hidden])");
    toast = await page.locator(".toast").innerText();
  },
});
check("popup reports the 404 redirects saved", /^\d+ redirects? saved in RedirHub\.$/.test(toast), toast);
const fourOhFours = {
  "www.acme-shop.test/products/blue-widgets": "https://www.acme-shop.test/products/blue-widget",
  "www.acme-shop.test/contact-us": "https://www.acme-shop.test/contact",
  "www.acme-shop.test/blog/redirect-chains-guide": "https://www.acme-shop.test/blog/how-to-fix-redirect-chains",
};
for (const [source, destination] of Object.entries(fourOhFours)) {
  const link = await findLink(source);
  check(`404 redirect ${source}`, link?.destination === destination, link && { id: link.id, destination: link.destination });
}

// ---------- 4. export other 404s as a CSV and import it in the dashboard ----------

const exported = [`/old-catalogue-${RUN}`, `/summer-deals-${RUN}`];
for (const path of exported) {
  await site.goto("https://www.acme-shop.test/products/");
  await site.evaluate((href) => (location.href = href), path);
  await site.waitForURL(`**${path}`);
}
await pause(300);
const popupPage = await context.newPage();
await popupPage.setViewportSize({ width: 440, height: 600 });
await popupPage.goto(`${base}/options.html`);
const tabId = await popupPage.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes(`acme-shop.test/summer-deals`))?.id);
await popupPage.goto(`${base}/popup.html?tab=${tabId}&view=404`);
await popupPage.waitForSelector(".footer");
const downloadEvent = popupPage.waitForEvent("download");
await popupPage.locator(".footer .btn", { hasText: "Export CSV" }).click();
const download = await downloadEvent;
const csvPath = join(out, "export.csv");
await download.saveAs(csvPath);
const csv = readFileSync(csvPath, "utf8");
await popupPage.close();
check("CSV has the import template's columns", csv.startsWith("source URL,destination,type\n"), csv);

const importer = await context.newPage();
await importer.setViewportSize({ width: 1280, height: 800 });
await importer.goto(`${DASHBOARD}/links/import`);
await importer.locator("input[type=file]").setInputFiles(csvPath);
const commit = importer.getByRole("button", { name: /^Import \d+ changes?$/ });
await commit.waitFor({ timeout: 60000 });
await importer.screenshot({ path: join(out, "6-dashboard-import-review.png") });
await commit.click();
await importer.getByText("Import complete").waitFor({ timeout: 120000 });
await importer.screenshot({ path: join(out, "7-dashboard-import-done.png") });
await importer.close();
for (const path of exported) {
  const source = `www.acme-shop.test${path}`;
  const link = await findLink(source);
  check(`imported ${source}`, Boolean(link), link && { id: link.id, destination: link.destination, type: link.type });
}

// ---------- 5. the links in the dashboard ----------

const links = await context.newPage();
await links.setViewportSize({ width: 1280, height: 800 });
await links.goto(`${DASHBOARD}/links?search=acme-shop.test`);
await links.getByText("acme-shop.test/summer-sale").first().waitFor({ timeout: 30000 }).catch(() => {});
await links.screenshot({ path: join(out, "8-dashboard-links.png") });
await links.close();

await context.close();
report.failures = failures;
console.log(JSON.stringify(report, null, 2));
process.exit(failures.length ? 1 : 0);
