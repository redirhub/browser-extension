// Shared by the e2e runs: the extension's pages, the tab ids it sees, and popup screenshots framed
// as Chrome shows them, under the toolbar icon of a browser window.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

/**
 * @param {import("playwright").BrowserContext} context with the extension loaded
 * @param {string} out where screenshots go
 */
export async function extensionSession(context, out) {
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
    <div class="ext"><img src="${img(readFileSync(join(root, "icons/icon-32.png")))}">${badge.text ? `<span class="badge" style="background:${badge.color}">${badge.text}</span>` : ""}</div></div>
    <img class="page" src="${img(pageShot)}"><img class="popup" src="${img(popupShot)}">`);
    await page.screenshot({ path: join(out, `${name}.png`) });
    await page.close();
  }

  /**
   * Opens the popup for the site's tab, runs `before` in it, saves a framed screenshot (and with
   * `full` the whole popup) and returns the popup's text.
   */
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

  return { base, site, pause, popup };
}
