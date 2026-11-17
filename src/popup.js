import { hopTone, shortUrl, statusLabel, statusText } from "./lib/chain.js";
import { rulesToCsv } from "./lib/rules.js";
import { URL_REGISTER } from "./lib/redirhub.js";
import { icon } from "./lib/icons.js";

const $ = (id) => document.getElementById(id);
const send = (message) => chrome.runtime.sendMessage(message);

const state = { tab: null, account: null, chain: null, notFound: [], scan: null, gateAction: null };

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function urlParts(url) {
  try {
    const u = new URL(url);
    return h("span", {}, h("span", { class: "scheme" }, u.protocol === "http:" ? "http://" : ""), h("b", {}, u.host), h("span", { class: "path" }, u.pathname + u.search));
  } catch {
    return h("span", {}, url);
  }
}

function toast(text, tone = "") {
  const el = $("toast");
  el.textContent = text;
  el.className = `toast ${tone}`;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 4000);
}

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const stripHash = (url) => url.split("#")[0];

// ---------- account ----------

function renderAccount() {
  const button = $("account");
  button.replaceChildren();
  if (state.account) {
    const initials = (state.account.name || state.account.email || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    button.className = "account";
    button.append(h("span", { class: "avatar" }, initials), (state.account.name || state.account.email).split(" ")[0]);
    button.title = `Signed in as ${state.account.email}`;
  } else {
    button.className = "account signed-out";
    button.textContent = "Sign in";
  }
}

function requireAccount(title, action) {
  if (state.account) return action();
  state.gateAction = action;
  $("gate-title").textContent = title;
  $("gate").hidden = false;
}

// ---------- redirects ----------

function lockMark() {
  return state.account ? null : h("span", { class: "lock", title: "Needs a RedirHub account" }, icon("lock", 13));
}

function hopRow(hop, index, hops) {
  const isFinal = index === hops.length - 1;
  const details = [];
  const text = statusText(hop);
  if (text) details.push(h("span", {}, text + (hop.kind === "meta" && hop.delay ? ` after ${hop.delay}s` : "")));
  if (hop.server) details.push(h("span", { class: "tag" }, hop.server));
  if (hop.redirectBy) details.push(h("span", { class: "tag" }, `by ${hop.redirectBy}`));
  if (hop.cached) details.push(h("span", { class: "tag" }, "from cache"));
  if (hop.ms != null && hop.kind !== "browser") details.push(h("span", {}, `${hop.ms} ms`));
  return h("li", { class: `hop ${isFinal ? "final" : ""}` },
    h("span", { class: `pill tone-${hopTone(hop)}` }, statusLabel(hop)),
    h("div", {}, h("div", { class: "url" }, urlParts(hop.url)), h("div", { class: "meta" }, details)),
  );
}

function summaryOf({ hops, analysis }) {
  const last = hops[hops.length - 1];
  const issues = analysis.issues.length;
  let title;
  let line;
  if (analysis.redirects === 0) {
    const missing = last.status === 404 || last.status === 410;
    title = last.status >= 400 ? `This page answers ${last.status}` : last.error ? "The page did not load" : "No redirects";
    if (missing) line = "Visitors and crawlers land on a missing page.";
    else if (last.status >= 400) line = `${statusText(last) || "An error"}: visitors see an error page.`;
    else line = last.error || `Loaded directly with ${last.status} ${statusText(last)}.`;
  } else {
    title = `${plural(analysis.redirects, "redirect")}${issues ? `, ${plural(issues, "issue")}` : ", all good"}`;
    line = `${shortUrl(hops[0].url)} → ${shortUrl(last.url)}`;
  }
  return h("div", { class: `summary ${analysis.level}` },
    h("div", { class: "big" }, analysis.redirects === 0 && last.status >= 400 ? "!" : analysis.redirects),
    h("div", {}, h("h1", {}, title), h("p", {}, line)),
  );
}

async function fixChain(rule, button) {
  button.disabled = true;
  const answer = await send({ type: "save-redirects", rules: [rule], note: "Added from the browser extension to replace a redirect chain with one 301." });
  const result = answer.ok ? answer.results[0] : { ok: false, error: answer.error };
  if (result.ok) {
    button.replaceChildren(icon("check"), "Saved in RedirHub");
    toast(`${result.updated ? "Updated" : "Saved"}: ${shortUrl(rule.source)} now goes straight to the final page.`, "success");
  } else {
    button.disabled = false;
    toast(`RedirHub could not save it: ${result.error}`);
  }
}

function renderChain() {
  const view = $("view-chain");
  view.replaceChildren();
  const { hops, analysis } = state.chain;
  const reload = h("button", { class: "btn", type: "button", onclick: () => chrome.tabs.reload(state.tab.id).then(() => window.close()) }, "Reload");

  if (!hops.length) {
    view.append(h("div", { class: "empty" }, h("div", { class: "icon" }, icon("refresh", 26)), h("strong", {}, "No trace for this page yet"), h("p", {}, "Reload it to see every redirect it goes through."), reload));
    return;
  }
  const last = hops[hops.length - 1];
  if (state.tab.url && stripHash(last.url) !== stripHash(state.tab.url)) {
    view.append(h("div", { class: "note" }, h("span", {}, "This trace is from the last full page load."), reload));
  }
  view.append(summaryOf(state.chain));
  view.append(h("ol", { class: "hops" }, hops.map(hopRow)));
  if (analysis.issues.length) {
    view.append(h("div", { class: "issues" }, analysis.issues.map((issue) => h("div", { class: `issue ${issue.level}` }, h("strong", {}, issue.title), h("span", {}, issue.text)))));
  }

  const fix = analysis.fix;
  const copy = h("button", { class: "btn", type: "button", onclick: copyChain }, "Copy");
  if (fix && fix.destination) {
    view.append(h("div", { class: "fix" },
      h("div", { class: "label" }, "One rule replaces this chain"),
      h("div", { class: "rule" }, h("b", {}, shortUrl(fix.source)), h("span", { class: "arrow" }, "→ 301 →"), shortUrl(fix.destination)),
    ));
    view.append(h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "button", onclick: (e) => requireAccount("Sign in to fix this chain", () => fixChain(fix, e.currentTarget)) }, lockMark(), "Fix in RedirHub"),
      copy,
    ));
  } else if (fix) {
    view.append(h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "button", onclick: () => selectTab("404") }, "Pick a destination in 404s"),
      copy,
    ));
  } else {
    view.append(h("div", { class: "actions" }, copy));
  }
}

async function copyChain() {
  const lines = state.chain.hops.map((hop) => `${statusLabel(hop)}\t${hop.url}`);
  const issues = state.chain.analysis.issues.map((issue) => `! ${issue.title}`);
  await navigator.clipboard.writeText([...lines, ...issues].join("\n"));
  toast("Chain copied.");
}

// ---------- 404s ----------

function host() {
  try {
    return new URL(state.tab.url).host;
  } catch {
    return null;
  }
}

async function loadNotFound() {
  const answer = await send({ type: "get-not-found", host: host() });
  state.notFound = (answer.items || []).map((item) => ({ ...item, selected: true, destination: item.suggestion.url }));
  state.capture = answer.settings?.capture404 ?? true;
  const count = $("nf-count");
  count.hidden = !state.notFound.length;
  count.textContent = state.notFound.length;
}

const WHY = { similar: "similar page", parent: "parent page", home: "home page" };

function seenLine(item) {
  const from = item.referrers[0] ? ` · linked from ${shortPath(item.referrers[0])}` : "";
  if (item.hits) return `Visited ${item.hits}×${from}`;
  return `Found by the link check${from}`;
}

function shortPath(url) {
  try {
    const u = new URL(url);
    return u.host === host() ? u.pathname : shortUrl(url);
  } catch {
    return url;
  }
}

function selectedRules() {
  return state.notFound.filter((item) => item.selected && item.destination).map((item) => ({ source: item.url, destination: item.destination, type: "301" }));
}

async function importRules() {
  const rules = selectedRules();
  const answer = await send({ type: "save-redirects", rules, note: "404 caught by the browser extension while browsing the site." });
  if (!answer.ok) return toast(answer.error);
  const saved = answer.results.filter((r) => r.ok);
  const failed = answer.results.filter((r) => !r.ok);
  if (saved.length) await send({ type: "remove-not-found", host: host(), urls: saved.map((r) => r.rule.source) });
  await loadNotFound();
  renderNotFound();
  toast(failed.length ? `${plural(saved.length, "redirect")} saved, ${failed.length} failed: ${failed[0].error}` : `${plural(saved.length, "redirect")} saved in RedirHub.`, failed.length ? "" : "success");
}

function exportCsv() {
  const csv = rulesToCsv(selectedRules());
  const link = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `redirects-${host()}.csv` });
  link.click();
  toast("CSV saved. Import it under Bulk import in RedirHub.");
}

async function scan() {
  const button = $("scan");
  button.disabled = true;
  button.replaceChildren("Checking links…");
  const answer = await send({ type: "scan-links", tabId: state.tab.id });
  state.scan = answer.ok ? answer : { error: "This page cannot be checked. Reload it and try again." };
  await loadNotFound();
  renderNotFound();
}

function renderNotFound() {
  const view = $("view-404");
  view.replaceChildren();
  const site = host();
  if (!site) {
    view.append(h("div", { class: "empty" }, h("strong", {}, "Open a website to catch its 404s")));
    return;
  }
  const toggle = h("input", { type: "checkbox", checked: state.capture, onchange: (e) => send({ type: "set-settings", settings: { capture404: e.target.checked } }) });
  view.append(h("div", { class: "site" },
    h("span", { class: "host" }, site),
    h("label", {}, "Catch 404s", h("span", { class: "switch" }, toggle, h("span"))),
  ));
  view.append(h("button", { class: "btn scan", id: "scan", type: "button", onclick: scan }, icon("search"), "Check the links on this page"));

  if (state.scan) {
    const s = state.scan;
    view.append(h("div", { class: "scan-result" }, s.error || [
      `Checked ${plural(s.checked, "link")}`,
      s.total > s.checked ? ` of ${s.total}` : "",
      `: ${s.broken.length} broken`,
      s.redirected.length ? `, ${s.redirected.length} through a redirect (link to the final URL instead)` : "",
      s.unchecked.length ? `, ${s.unchecked.length} could not be checked (sign-in, bot protection or a network error)` : "",
      ".",
    ].join("")));
    if (s.redirected?.length) view.append(redirectedLinks(s.redirected));
  }

  if (!state.notFound.length) {
    view.append(h("div", { class: "empty" }, h("div", { class: "icon" }, icon("circleCheck", 26)), h("strong", {}, `No 404s caught on ${site}`), h("p", {}, "Browse the site or check this page's links. Every page that answers 404 shows up here, ready to redirect.")));
    return;
  }

  view.append(h("div", { class: "nf-head" },
    h("span", {}, `${plural(state.notFound.length, "missing page")} · stored in this browser only`),
    h("button", { class: "link", type: "button", onclick: async () => { await send({ type: "remove-not-found", host: site, urls: state.notFound.map((i) => i.url) }); await loadNotFound(); renderNotFound(); } }, "Clear"),
  ));
  view.append(h("ul", { class: "nf-list" }, state.notFound.map((item) =>
    h("li", { class: "nf" },
      h("input", { type: "checkbox", checked: item.selected, onchange: (e) => { item.selected = e.target.checked; renderFooter(); } }),
      h("div", {},
        h("div", { class: "top" }, h("span", { class: "pill tone-error" }, item.status), h("span", { class: "path" }, item.path)),
        h("div", { class: "seen" }, seenLine(item)),
        h("div", { class: "to" },
          h("span", { class: "arrow" }, "→"),
          h("input", { type: "text", value: item.destination, oninput: (e) => { item.destination = e.target.value.trim(); renderFooter(); } }),
          h("span", { class: "why" }, WHY[item.suggestion.reason]),
        ),
      ),
    ),
  )));
  view.append(h("div", { class: "footer", id: "nf-footer" }));
  renderFooter();
}

const SHOWN_REDIRECTED = 5;

/** The page's links that answer with a redirect, each with where it ends up. */
function redirectedLinks(links) {
  const more = links.length - SHOWN_REDIRECTED;
  return h("div", { class: "redirected" },
    h("div", { class: "label" }, "Links that go through a redirect"),
    h("ul", {}, links.slice(0, SHOWN_REDIRECTED).map((link) =>
      h("li", {}, h("span", { class: "from" }, shortPath(link.url)), h("span", { class: "arrow" }, "→"), h("span", { class: "to" }, shortPath(link.finalUrl))),
    )),
    more > 0 ? h("button", { class: "link", type: "button", onclick: async () => {
      await navigator.clipboard.writeText(links.map((l) => `${l.url}\t${l.finalUrl}`).join("\n"));
      toast(`${plural(links.length, "link")} copied with their final URLs.`);
    } }, `Copy all ${links.length}`) : null,
  );
}

function renderFooter() {
  const footer = $("nf-footer");
  if (!footer) return;
  const count = selectedRules().length;
  footer.replaceChildren(
    h("span", { class: "sel" }, `${count} selected`),
    h("button", { class: "btn", type: "button", disabled: !count, onclick: () => requireAccount("Sign in to export rules", exportCsv) }, lockMark(), "Export CSV"),
    h("button", { class: "btn primary", type: "button", disabled: !count, onclick: () => requireAccount("Sign in to save these redirects", importRules) }, lockMark(), `Create ${plural(count, "redirect")}`),
  );
}

// ---------- shell ----------

function selectTab(name) {
  const chain = name === "chain";
  $("tab-chain").setAttribute("aria-selected", chain);
  $("tab-404").setAttribute("aria-selected", !chain);
  $("view-chain").hidden = !chain;
  $("view-404").hidden = chain;
}

async function activeTab() {
  const requested = Number(new URLSearchParams(location.search).get("tab"));
  if (requested) return chrome.tabs.get(requested);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function main() {
  state.tab = await activeTab();
  const [auth, chain] = await Promise.all([send({ type: "get-auth" }), send({ type: "get-chain", tabId: state.tab.id }), loadNotFound()]);
  state.account = auth.account;
  state.chain = chain;
  renderAccount();
  renderChain();
  renderNotFound();

  const view = new URLSearchParams(location.search).get("view");
  const last = chain.hops[chain.hops.length - 1];
  selectTab(view || (last && last.status >= 400 && state.notFound.length && chain.analysis.redirects === 0 ? "404" : "chain"));

  $("tab-chain").onclick = () => selectTab("chain");
  $("tab-404").onclick = () => selectTab("404");
  // Signing in runs on the options page, which stays open while the user is on RedirHub.
  const connect = () => chrome.tabs.create({ url: chrome.runtime.getURL("src/options.html#connect") }).then(() => window.close());
  $("account").onclick = () => (state.account ? chrome.runtime.openOptionsPage() : connect());
  $("gate-connect").onclick = connect;
  $("gate-register").onclick = () => chrome.tabs.create({ url: URL_REGISTER });
  $("gate-close").onclick = () => ($("gate").hidden = true);
  $("gate-icon").append(icon("lock", 22));
}

main();
