import { shortUrl } from "./lib/chain.js";
import { h, plural, toast } from "./lib/dom.js";
import { CATEGORIES, errorLabel, parseDomains, resultsToCsv } from "./lib/domains.js";
import { openSignIn, showGate } from "./lib/gate.js";
import { icon } from "./lib/icons.js";

const $ = (id) => document.getElementById(id);
const send = (message) => chrome.runtime.sendMessage(message);

const TONES = { live: "ok", redirect: "redirect", "for-sale": "sale", parked: "warn", broken: "error", "no-dns": "muted" };
const DOTS = { live: "#20A795", redirect: "#1C6DB6", "for-sale": "#7A5AF8", parked: "#E59426", broken: "#D92D20", "no-dns": "#98A2B3" };
const NOTE = "Forwarded from the RedirHub domain checker.";

const state = {
  account: null,
  order: [],
  results: new Map(),
  filter: "all",
  picked: new Set(),
  saved: new Set(),
  port: null,
  checkedAt: null,
};

const hasHttpsIssue = (r) => r.flags.some((flag) => flag.startsWith("HTTPS"));

// ---------- account ----------

function renderAccount() {
  const button = $("account");
  button.replaceChildren();
  if (state.account) {
    const name = state.account.name || state.account.email;
    button.className = "account";
    button.append(h("span", { class: "avatar" }, name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()), name.split(" ")[0]);
    button.onclick = () => chrome.runtime.openOptionsPage();
  } else {
    button.className = "account signed-out";
    button.textContent = "Sign in";
    button.onclick = () => openSignIn();
  }
  renderActions();
}

const lock = () => (state.account ? null : h("span", { class: "lock", title: "Needs a RedirHub account" }, icon("lock", 13)));

function requireAccount(title, action) {
  if (state.account) return action();
  showGate(title);
}

// ---------- the list ----------

function readList() {
  const { domains, invalid, extra } = parseDomains($("list").value);
  const notes = [plural(domains.length, "domain")];
  if (invalid.length) notes.push(`${plural(invalid.length, "entry", "entries")} skipped (not a domain)`);
  if (extra) notes.push(`${plural(extra, "more domain")} over the 1,000 limit left out`);
  $("count").textContent = domains.length || invalid.length ? notes.join(" · ") : "";
  $("run").disabled = !domains.length || Boolean(state.port);
  $("run").textContent = domains.length ? `Check ${plural(domains.length, "domain")}` : "Check domains";
  return domains;
}

// ---------- running ----------

function run() {
  const domains = readList();
  if (!domains.length) return;
  state.order = domains;
  state.results = new Map();
  state.picked.clear();
  state.saved.clear();
  state.filter = "all";
  state.checkedAt = Date.now();
  progress(0, domains.length);
  render();

  const port = chrome.runtime.connect({ name: "domain-check" });
  state.port = port;
  readList();
  port.onMessage.addListener((message) => {
    if (message.type === "result") {
      state.results.set(message.result.domain, message.result);
      progress(message.done, message.total);
      render();
    }
    if (message.type === "finished") {
      finish();
      toast(`Checked ${plural(domains.length, "domain")}.`, "success");
    }
  });
  port.onDisconnect.addListener(finish);
  port.postMessage({ domains });
}

function finish() {
  state.port?.disconnect();
  state.port = null;
  $("progress").hidden = true;
  readList();
  render();
}

function progress(done, total) {
  $("progress").hidden = false;
  $("bar").style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  $("progress-text").textContent = `Checked ${done.toLocaleString("en")} of ${plural(total, "domain")}`;
}

// ---------- results ----------

function visible() {
  return state.order.filter((domain) => {
    if (state.filter === "all") return true;
    const r = state.results.get(domain);
    if (!r) return false;
    return state.filter === "https" ? hasHttpsIssue(r) : r.category === state.filter;
  });
}

function summary() {
  const done = [...state.results.values()];
  const chip = (key, label, count, dot) => h("button", {
    class: "chip", type: "button", "aria-pressed": String(state.filter === key),
    onclick: () => { state.filter = key; render(); },
  }, dot ? h("span", { class: "dot", style: `background:${dot}` }) : null, label, h("b", {}, count.toLocaleString("en")));
  return [
    chip("all", "All", state.order.length),
    ...Object.keys(CATEGORIES).map((key) => [key, done.filter((r) => r.category === key).length]).filter(([, n]) => n)
      .map(([key, n]) => chip(key, CATEGORIES[key], n, DOTS[key])),
    ...(done.some(hasHttpsIssue) ? [chip("https", "HTTPS issues", done.filter(hasHttpsIssue).length, "#B26A12")] : []),
  ];
}

function httpsCell(r) {
  if (r.https.error) return h("span", { class: "bad-text" }, errorLabel(r.https.error));
  if (r.https.status >= 400) return h("span", { class: "bad-text" }, `Answers ${r.https.status}`);
  return h("span", { class: "ok-text" }, "Works");
}

/** The final address under the verdict, when it says more than the verdict already does. */
function destinationNote(domain, r) {
  if (!r.destination) return null;
  const url = new URL(r.destination);
  const own = url.hostname === domain || url.hostname === `www.${domain}`;
  if (r.category === "redirect") return url.pathname !== "/" || url.search ? shortUrl(r.destination) : null;
  if ((r.category === "for-sale" || r.category === "parked") && !own) return shortUrl(r.destination);
  return null;
}

function row(domain) {
  const r = state.results.get(domain);
  if (!r) {
    return h("tr", { class: "pending" }, h("td", { class: "pick" }), h("td", { class: "domain" }, domain), h("td", { colspan: 5 }, state.port ? "Checking…" : "Not checked"));
  }
  const codes = r.hops.filter((hop) => hop.status >= 300 && hop.status < 400).map((hop) => hop.status);
  const dest = destinationNote(domain, r);
  // HTTPS problems have their own column.
  const flags = r.flags.filter((flag) => !flag.startsWith("HTTPS"));
  return h("tr", { "data-domain": domain },
    h("td", { class: "pick" }, h("input", {
      type: "checkbox", checked: state.picked.has(domain), "aria-label": `Select ${domain}`,
      onchange: (e) => { e.target.checked ? state.picked.add(domain) : state.picked.delete(domain); renderActions(); },
    })),
    h("td", { class: "domain" }, domain),
    h("td", { class: "verdict" }, h("span", { class: `pill tone-${TONES[r.category]}` }, CATEGORIES[r.category])),
    h("td", { class: "where" },
      r.label,
      dest ? h("span", { class: "dest" }, dest) : null,
      flags.length || state.saved.has(domain) ? h("div", { class: "flags" },
        state.saved.has(domain) ? h("span", { class: "saved" }, "Forwarded in RedirHub") : null,
        flags.map((flag) => h("span", { class: "flag" }, flag))) : null,
    ),
    h("td", {}, httpsCell(r)),
    h("td", { class: "codes" }, codes.length ? codes.join(" → ") : "—"),
    h("td", { class: "num" }, `${r.ms.toLocaleString("en")} ms`),
  );
}

function render() {
  $("results").hidden = !state.order.length;
  $("summary").replaceChildren(...summary());
  const shown = visible();
  $("rows").replaceChildren(...shown.map(row));
  const pickable = shown.filter((domain) => state.results.has(domain));
  $("pick-all").checked = pickable.length > 0 && pickable.every((domain) => state.picked.has(domain));
  $("pick-all").onchange = (e) => {
    pickable.forEach((domain) => (e.target.checked ? state.picked.add(domain) : state.picked.delete(domain)));
    render();
  };
  renderActions();
}

function renderActions() {
  const done = state.results.size > 0;
  $("actions").hidden = !done;
  if (!done) return;
  const count = state.picked.size;
  $("selected").textContent = count ? `${plural(count, "domain")} selected` : "Select domains to forward them";
  $("export").replaceChildren(...[lock(), count ? `Export ${count} as CSV` : "Export all as CSV"].filter(Boolean));
  $("forward").replaceChildren(...[lock(), count ? `Forward ${plural(count, "domain")}…` : "Forward domains…"].filter(Boolean));
  $("forward").disabled = !count;
}

// ---------- export and forward (need an account) ----------

function exportCsv() {
  const domains = state.picked.size ? [...state.picked] : state.order;
  const csv = resultsToCsv(domains.map((domain) => state.results.get(domain)).filter(Boolean));
  h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `domains-${new Date().toISOString().slice(0, 10)}.csv` }).click();
  toast("CSV saved.");
}

function forwardDialog() {
  const domains = state.order.filter((domain) => state.picked.has(domain));
  const close = () => dialog.remove();
  const input = h("input", { type: "text", id: "destination", placeholder: "https://www.example.com/", autocomplete: "url" });
  const error = h("div", { class: "error", hidden: true });
  const submit = h("button", { class: "btn primary", type: "submit" }, `Forward ${plural(domains.length, "domain")}`);
  const form = h("form", {
    class: "dialog-card", role: "dialog", "aria-labelledby": "forward-title",
    onsubmit: async (e) => {
      e.preventDefault();
      let destination;
      try {
        destination = new URL(input.value.trim()).toString();
        if (!/^https?:$/.test(new URL(destination).protocol)) throw new Error();
      } catch {
        error.textContent = "Enter the full address to send visitors to, starting with https://";
        error.hidden = false;
        return;
      }
      submit.disabled = true;
      submit.textContent = "Saving…";
      const rules = domains.map((domain) => ({ source: `http://${domain}/`, destination, type: "301" }));
      const answer = await send({ type: "save-redirects", rules, note: NOTE });
      close();
      if (!answer.ok) return toast(answer.error);
      const saved = answer.results.filter((r) => r.ok);
      const failed = answer.results.filter((r) => !r.ok);
      saved.forEach((r) => {
        const domain = new URL(r.rule.source).hostname;
        state.saved.add(domain);
        state.picked.delete(domain);
      });
      render();
      toast(failed.length ? `${plural(saved.length, "domain")} forwarded, ${failed.length} failed: ${failed[0].error}` : `${plural(saved.length, "domain")} forwarded in RedirHub with a 301.`, failed.length ? "" : "success");
    },
  },
  h("h2", { id: "forward-title" }, `Forward ${plural(domains.length, "domain")}`),
  h("p", {}, "Each domain gets a 301 to this address. RedirHub serves it once the domain's DNS points to RedirHub; the dashboard shows what to set."),
  h("label", { for: "destination" }, "Send visitors to"),
  input,
  error,
  h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: close }, "Cancel"), submit));
  const dialog = h("div", { class: "dialog" }, form);
  document.body.append(dialog);
  input.focus();
}

// ---------- start ----------

async function main() {
  const [auth, stored] = await Promise.all([send({ type: "get-auth" }), chrome.storage.local.get("domainCheck")]);
  state.account = auth.account;
  const last = stored.domainCheck;
  if (last?.results?.length) {
    state.order = last.results.map((r) => r.domain);
    last.results.forEach((r) => state.results.set(r.domain, r));
    state.checkedAt = last.at;
    $("list").value = state.order.join("\n");
  }
  renderAccount();
  readList();
  render();

  $("list").addEventListener("input", readList);
  $("run").addEventListener("click", run);
  $("stop").addEventListener("click", finish);
  $("export").addEventListener("click", () => requireAccount("Sign in to export results", exportCsv));
  $("forward").addEventListener("click", () => requireAccount("Sign in to forward domains", forwardDialog));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.auth) {
      state.account = changes.auth.newValue?.account || null;
      renderAccount();
    }
  });
}

main();
