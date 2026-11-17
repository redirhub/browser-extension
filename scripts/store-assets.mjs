// Makes the Chrome Web Store images from an e2e run (e2e/run.mjs):
// five 1280x800 screenshots and the 440x280 small promo tile, in store/.
//   node scripts/store-assets.mjs <shotsDir>
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = resolve(import.meta.dirname, "..");
const shots = resolve(process.argv[2] || join(root, "e2e", "shots"));
const out = join(root, "store");
const SCREENSHOTS = ["1-chain", "5-404-list", "8-fixed-chain", "4-404-page", "3-clean"];
const dataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

await page.setViewportSize({ width: 1280, height: 800 });
for (const [i, name] of SCREENSHOTS.entries()) {
  await page.setContent(`<body style="margin:0"><img src="${dataUrl(join(shots, `${name}.png`))}" style="display:block;width:1280px;height:800px">`);
  await page.screenshot({ path: join(out, `screenshot-${i + 1}.png`) });
}

// The promo tile: a redirect chain collapsing into one hop, no words.
await page.setViewportSize({ width: 440, height: 280 });
await page.setContent(`<!doctype html><style>
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
await page.screenshot({ path: join(out, "promo-small-440x280.png") });

await browser.close();
console.log(`store images in ${out}`);
