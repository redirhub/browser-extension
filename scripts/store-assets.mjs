// The Chrome Web Store images, taken in a real Chrome window on live sites:
// five 1280x800 screenshots with the extension's real toolbar icon, badge and
// popup, and the 440x280 promo tile. Writes store/.
//
//   node scripts/store-assets.mjs [--keep <dir>]   (--keep also saves 2x originals)
//
// Needs Xvfb and ImageMagick. Behind an HTTPS proxy (HTTPS_PROXY), set
// CA_BUNDLE to the proxy's CA file so pages load with a normal padlock.
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = resolve(import.meta.dirname, "..");
const out = join(root, "store");
const keepIndex = process.argv.indexOf("--keep");
const keep = keepIndex > 0 ? resolve(process.argv[keepIndex + 1]) : null;
const DISPLAY = ":97";
const DEBUG_PORT = 9333;

// ---------- a profile with the extension pinned ----------

const home = mkdtempSync(join(tmpdir(), "rh-store-"));
if (process.env.CA_BUNDLE) {
  const nss = join(home, ".pki/nssdb");
  mkdirSync(nss, { recursive: true });
  execFileSync("certutil", ["-d", `sql:${nss}`, "-N", "--empty-password"]);
  const certs = readFileSync(process.env.CA_BUNDLE, "utf8").match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  certs.forEach((cert, i) => {
    const file = join(home, `ca${i}.pem`);
    writeFileSync(file, cert);
    execFileSync("certutil", ["-d", `sql:${nss}`, "-A", "-n", `ca${i}`, "-t", "C,,", "-i", file]);
  });
}
// An unpacked extension's id is the SHA-256 of its path, written with the letters a-p.
const id = [...createHash("sha256").update(root).digest("hex").slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
const profile = join(home, "profile");
mkdirSync(join(profile, "Default"), { recursive: true });
writeFileSync(join(profile, "Default/Preferences"), JSON.stringify({ extensions: { pinned_extensions: [id] } }));

const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", "2560x1600x24", "-nolisten", "tcp"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: null,
  env: { ...process.env, HOME: home, DISPLAY, NO_PROXY: "127.0.0.1,localhost" },
  ignoreDefaultArgs: ["--enable-automation"],
  args: [
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
    "--force-device-scale-factor=2",
    "--window-size=1280,800",
    "--window-position=0,0",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-crash-restore-bubble",
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--lang=en-US",
    ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : []),
  ],
});
if (!context.serviceWorkers().length) await context.waitForEvent("serviceworker");
const site = context.pages()[0] || (await context.newPage());
const wait = (ms) => site.waitForTimeout(ms);
await wait(1500);

// ---------- helpers ----------

async function visit(url, { via } = {}) {
  if (via) await site.evaluate((href) => (location.href = href), url).catch(() => {});
  else await site.goto(url, { waitUntil: "load", timeout: 60000 }).catch(() => {});
  await site.waitForLoadState("load").catch(() => {});
  await wait(1200);
}

/** Consent banners would sit under the popup; hide the common ones. */
async function hideBanners() {
  await site.addStyleTag({ content: "#onetrust-consent-sdk,#onetrust-banner-sdk,.onetrust-pc-dark-filter,#CybotCookiebotDialog,[id*=cookie-banner],[class*=cookie-banner],[aria-label*=cookie i][role=dialog]{display:none!important}" }).catch(() => {});
}

/** Runs an expression in the open popup, through the DevTools protocol (Playwright does not see popups). */
async function inPopup(expression) {
  for (let i = 0; i < 20; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const target = targets.find((t) => t.url.includes(`${id}/src/popup.html`));
    if (target) {
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((r) => (ws.onopen = r));
      const reply = await new Promise((r) => {
        ws.onmessage = (m) => r(JSON.parse(m.data));
        ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
      });
      ws.close();
      return reply.result?.result?.value;
    }
    await wait(250);
  }
  throw new Error("The popup did not open");
}

async function openPopup() {
  const worker = context.serviceWorkers().at(-1);
  await site.bringToFront();
  await worker.evaluate(() => chrome.action.openPopup());
  await inPopup(`new Promise((r) => { const ready = () => document.querySelector("#view-chain > *") ? r(true) : setTimeout(ready, 50); ready(); })`);
  await wait(500);
}

let shot = 0;
async function capture(label) {
  shot += 1;
  const full = join(keep || home, `${shot}-${label}.png`);
  execFileSync("import", ["-display", DISPLAY, "-window", "root", full]);
  execFileSync("convert", [full, "-resize", "1280x800!", join(out, `screenshot-${shot}.png`)]);
  await site.keyboard.press("Escape");
  await wait(400);
}

// ---------- the five screenshots ----------

// 1. A retired product URL that takes five hops.
await visit("https://apple.com/iphone15");
await hideBanners();
await openPopup();
await capture("chain-5-hops");

// 2. Three hops through a CDN; the popup scrolled to the one-rule fix.
await visit("https://www.hp.com");
await hideBanners();
await openPopup();
await inPopup(`document.querySelector("main").scrollTo(0, 99999)`);
await wait(300);
await capture("chain-fix");

// 3. 404s caught while browsing a site: live pages first, then old links.
const SITE = "https://www.redirhub.com";
for (const path of ["/", "/pricing", "/about", "/blog", "/blog/301-vs-302-redirect-2026", "/blog/how-to-redirect-a-url-in-wordpress", "/dynamic-qr-codes", "/website-migrations"]) {
  await visit(SITE + path);
}
const OLD = [["/pricing", "/pricing-plans"], ["/about", "/about-us"], ["/dynamic-qr-codes", "/qr-code-generator"], ["/blog", "/blog/redirect-url-in-wordpress"], ["/blog", "/blog/301-vs-302-redirects"]];
for (const [from, to] of OLD) {
  await visit(SITE + from);
  await visit(SITE + to, { via: true });
}
await hideBanners();
await openPopup();
await capture("404-caught");

// 4. The link check on a page with a broken link and many redirected ones.
await visit("https://www.apple.com/iphone/");
await hideBanners();
await openPopup();
await inPopup(`document.getElementById("tab-404").click()`);
await inPopup(`new Promise((r) => { document.getElementById("scan").click(); const done = () => document.querySelector(".scan-result") ? r(true) : setTimeout(done, 100); done(); })`);
await wait(500);
await capture("link-check");

// 5. Saving needs an account.
await visit(SITE + "/blog/301-vs-302-redirects");
await hideBanners();
await openPopup();
await inPopup(`document.querySelector(".footer .btn.primary").click()`);
await wait(400);
await capture("sign-in");

await context.close();

// ---------- the promo tile: a redirect chain collapsing into one hop ----------

const dataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;
const browser = await chromium.launch();
const tile = await browser.newPage({ viewport: { width: 440, height: 280 } });
await tile.setContent(`<!doctype html><style>
  body{margin:0;width:440px;height:280px;background:linear-gradient(135deg,#1C6DB6,#164f86 70%);display:grid;place-items:center;font:800 22px system-ui;overflow:hidden}
  .wrap{display:flex;flex-direction:column;gap:18px;align-items:center}
  .row{display:flex;align-items:center;gap:10px}
  .pill{border-radius:9px;padding:6px 12px;color:#fff;background:rgba(255,255,255,.14)}
  .pill.warn{background:#E59426}.pill.ok{background:#20A795}
  .dash{width:22px;border-top:3px dotted rgba(255,255,255,.55)}
  .arrow{width:120px;height:4px;background:#fff;border-radius:2px;position:relative}
  .arrow::after{content:"";position:absolute;right:-4px;top:-7px;border:9px solid transparent;border-left:12px solid #fff;border-right:0}
  img{width:58px;height:58px;filter:drop-shadow(0 6px 14px rgba(0,0,0,.25))}
</style><div class="wrap">
  <div class="row" style="opacity:.75"><span class="pill">301</span><span class="dash"></span><span class="pill warn">302</span><span class="dash"></span><span class="pill">301</span><span class="dash"></span><span class="pill ok">200</span></div>
  <div class="row"><img src="${dataUrl(join(root, "icons/icon-128.png"))}"><span class="pill">301</span><span class="arrow"></span><span class="pill ok">200</span></div>
</div>`);
await tile.screenshot({ path: join(out, "promo-small-440x280.png") });
await browser.close();
xvfb.kill();
console.log(`store images in ${out}`);
