// Watches every top-level navigation: the redirects it went through (server
// 3xx, HSTS upgrades, meta refresh, JavaScript) and the 404s it ended on.
// Everything stays in the browser until the user exports or imports it.

import { analyzeChain } from "./lib/chain.js";
import { classify } from "./lib/domains.js";
import { suggestDestination } from "./lib/suggest.js";
import { callTool } from "./lib/mcp.js";
import { needsRefresh, refreshTokens } from "./lib/oauth.js";
import { getAccount, saveRedirects } from "./lib/redirhub.js";

const FILTER = { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] };
const KEEP_HEADERS = ["server", "location", "x-redirect-by", "x-powered-by", "cache-control", "non-authoritative-reason"];
const MAX_SEEN = 500;
const MAX_NOT_FOUND = 300;
const SCAN_LIMIT = 200;
const SCAN_CONCURRENCY = 6;

/** In-flight requests by requestId. */
const requests = new Map();

/**
 * Chrome sometimes aborts a navigation midway and restarts it as a new request
 * for the same URL (a process swap, for one). The restart inherits the hops.
 */
const aborted = new Map();
const RESTART_WINDOW_MS = 5000;

// ---------- storage helpers ----------

const queues = new Map();
/** Read-modify-write one storage key without losing concurrent updates. */
function update(area, key, change) {
  const run = (queues.get(key) || Promise.resolve()).then(async () => {
    const current = (await chrome.storage[area].get(key))[key];
    const next = await change(current);
    if (next === undefined) await chrome.storage[area].remove(key);
    else await chrome.storage[area].set({ [key]: next });
    return next;
  });
  queues.set(key, run.catch(() => {}));
  return run;
}

async function settings() {
  const { settings: stored } = await chrome.storage.local.get("settings");
  return { capture404: true, ...(stored || {}) };
}

// ---------- server side: webRequest ----------

function pickHeaders(headers = []) {
  const out = {};
  for (const { name, value } of headers) {
    const key = name.toLowerCase();
    if (KEEP_HEADERS.includes(key)) out[key] = value;
  }
  return out;
}

chrome.webRequest.onBeforeRequest.addListener((details) => {
  if (details.tabId < 0 || requests.has(details.requestId)) return;
  const restart = aborted.get(details.tabId);
  aborted.delete(details.tabId);
  const inherits = restart && restart.url === details.url && details.timeStamp - restart.at < RESTART_WINDOW_MS;
  requests.set(details.requestId, {
    tabId: details.tabId,
    hops: inherits ? restart.hops : [],
    lastAt: details.timeStamp,
    headers: {},
    referer: null,
  });
}, FILTER);

chrome.webRequest.onSendHeaders.addListener((details) => {
  const request = requests.get(details.requestId);
  if (!request || request.hops.length) return;
  const referer = details.requestHeaders?.find((h) => h.name.toLowerCase() === "referer");
  request.referer = referer ? referer.value : null;
}, FILTER, ["requestHeaders", "extraHeaders"]);

chrome.webRequest.onHeadersReceived.addListener((details) => {
  const request = requests.get(details.requestId);
  if (request) request.headers = pickHeaders(details.responseHeaders);
}, FILTER, ["responseHeaders", "extraHeaders"]);

chrome.webRequest.onBeforeRedirect.addListener((details) => {
  const request = requests.get(details.requestId);
  if (!request) return;
  const internal = /internal redirect/i.test(details.statusLine || "") || Boolean(request.headers["non-authoritative-reason"]);
  request.hops.push({
    url: details.url,
    status: details.statusCode,
    kind: internal ? "browser" : "server",
    to: details.redirectUrl,
    server: request.headers.server || null,
    redirectBy: request.headers["x-redirect-by"] || null,
    ip: details.ip || null,
    cached: Boolean(details.fromCache),
    ms: Math.round(details.timeStamp - request.lastAt),
  });
  request.lastAt = details.timeStamp;
  request.headers = {};
}, FILTER, ["responseHeaders"]);

chrome.webRequest.onCompleted.addListener((details) => {
  const request = requests.get(details.requestId);
  requests.delete(details.requestId);
  if (!request) return;
  const final = {
    url: details.url,
    status: details.statusCode,
    kind: "final",
    server: request.headers.server || null,
    ip: details.ip || null,
    cached: Boolean(details.fromCache),
    ms: Math.round(details.timeStamp - request.lastAt),
  };
  finishSegment(request.tabId, [...request.hops, final]);
  if (details.statusCode === 404 || details.statusCode === 410) {
    recordNotFound(details.url, details.statusCode, request.referer, "visit");
  } else if (details.statusCode >= 200 && details.statusCode < 300) {
    recordLive(details.url);
  }
}, FILTER);

chrome.webRequest.onErrorOccurred.addListener((details) => {
  const request = requests.get(details.requestId);
  requests.delete(details.requestId);
  if (!request) return;
  if (/ERR_ABORTED/.test(details.error)) {
    aborted.set(request.tabId, { url: details.url, hops: request.hops, at: details.timeStamp });
    return;
  }
  const error = details.error.replace(/^net::/, "");
  finishSegment(request.tabId, [...request.hops, { url: details.url, status: 0, kind: "final", error }]);
}, FILTER);

// ---------- client side: meta refresh and JavaScript ----------
//
// A meta refresh or a script starts a new navigation, so the browser reports
// it as a new request. webNavigation tells us it was a client redirect; the
// content script tells us whether the page had a meta refresh.

const tabKey = (tabId) => `tab:${tabId}`;

/** A segment is one request's hops. A tab keeps the segments of its current chain. */
function finishSegment(tabId, hops) {
  return update("session", tabKey(tabId), (state = { segments: [], commits: [], meta: {} }) => {
    const finalUrl = hops[hops.length - 1].url;
    const commit = state.commits.find((c) => c.url === finalUrl);
    const segment = { hops, client: commit ? commit.client : null, at: Date.now() };
    state.commits = state.commits.filter((c) => c !== commit);
    state.segments = joinSegments(state.segments, segment);
    return state;
  }).then((state) => paintBadge(tabId, state));
}

/** A new navigation starts a chain; a client redirect (or one not committed yet) extends it. */
function joinSegments(segments, segment) {
  if (segment.client === false) return [segment];
  return [...segments.filter((s) => s.client !== null), segment];
}

chrome.webNavigation.onCommitted.addListener(({ tabId, frameId, url, transitionQualifiers }) => {
  if (frameId !== 0 || !/^https?:/.test(url)) return;
  const client = transitionQualifiers.includes("client_redirect");
  update("session", tabKey(tabId), (state = { segments: [], commits: [], meta: {} }) => {
    const index = findLastIndex(state.segments, (s) => s.client === null && s.hops[s.hops.length - 1].url === url);
    if (index === -1) {
      // The request has not finished yet, or came from the back/forward cache.
      state.commits = [...state.commits.slice(-4), { url, client }];
      return state;
    }
    const segment = { ...state.segments[index], client };
    const earlier = state.segments.slice(0, index).filter((s) => s.client !== null);
    state.segments = client ? [...earlier, segment] : [segment];
    return state;
  }).then((state) => paintBadge(tabId, state));
});

function findLastIndex(list, test) {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return i;
  return -1;
}

/** The chain the tab ended on: committed segments joined by their client redirects. */
function chainOf(state) {
  const segments = (state?.segments || []).filter((s) => s.client !== null);
  const hops = [];
  segments.forEach((segment, i) => {
    if (i > 0) {
      const previous = hops[hops.length - 1];
      const meta = state.meta?.[previous.url];
      previous.kind = meta ? "meta" : "js";
      previous.to = segment.hops[0].url;
      if (meta) previous.delay = meta.delay;
    }
    hops.push(...segment.hops.map((hop) => ({ ...hop })));
  });
  return hops;
}

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(tabKey(tabId)));

// ---------- 404 catcher ----------

function recordLive(url) {
  const u = new URL(url);
  return update("local", `live:${u.host}`, (paths = []) => {
    const next = paths.filter((p) => p !== u.pathname);
    next.push(u.pathname);
    return next.slice(-MAX_SEEN);
  });
}

async function recordNotFound(url, status, referer, source) {
  if (!(await settings()).capture404) return;
  const u = new URL(url);
  u.hash = "";
  const key = u.toString();
  return update("local", `nf:${u.host}`, (list = {}) => {
    const now = Date.now();
    const entry = list[key] || { url: key, path: u.pathname + u.search, status, hits: 0, firstSeen: now, referrers: [], source };
    entry.hits += source === "visit" ? 1 : 0;
    entry.lastSeen = now;
    entry.status = status;
    if (referer && !entry.referrers.includes(referer)) entry.referrers = [referer, ...entry.referrers].slice(0, 3);
    list[key] = entry;
    const keys = Object.keys(list);
    if (keys.length > MAX_NOT_FOUND) {
      keys.sort((a, b) => list[a].lastSeen - list[b].lastSeen).slice(0, keys.length - MAX_NOT_FOUND).forEach((k) => delete list[k]);
    }
    return list;
  });
}

async function notFoundFor(host) {
  const store = await chrome.storage.local.get([`nf:${host}`, `live:${host}`]);
  const list = Object.values(store[`nf:${host}`] || {});
  const live = store[`live:${host}`] || [];
  return list
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map((entry) => ({ ...entry, suggestion: suggestDestination(entry.url, live) }));
}

const isMissing = (status) => status === 404 || status === 410;

async function checkUrl(url) {
  const attempt = (method) => fetch(url, { method, redirect: "follow", credentials: "include", cache: "no-store" });
  try {
    let response = await attempt("HEAD");
    // Plenty of servers refuse HEAD (403, 405, 501): ask again the way a browser would.
    if (response.status >= 400 && !isMissing(response.status)) response = await attempt("GET");
    return { url, status: response.status, redirected: response.redirected, finalUrl: response.url };
  } catch (error) {
    return { url, status: 0, error: String(error.message || error) };
  }
}

async function scanLinks(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const { links = [] } = await chrome.tabs.sendMessage(tabId, { type: "collect-links" });
  const queue = links.slice(0, SCAN_LIMIT);
  const results = [];
  async function worker() {
    while (queue.length) {
      const url = queue.shift();
      results.push(await checkUrl(url));
    }
  }
  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
  for (const result of results) {
    if (isMissing(result.status)) await recordNotFound(result.url, result.status, tab.url, "scan");
    else if (result.status >= 200 && result.status < 300 && !result.redirected) await recordLive(result.url);
    else if (result.redirected && result.status < 300) await recordLive(result.finalUrl);
  }
  return {
    checked: results.length,
    total: links.length,
    broken: results.filter((r) => isMissing(r.status)),
    redirected: results.filter((r) => r.redirected && r.status < 400),
    // Answered something else than a page or a 404: a login wall, a bot check, a server error.
    unchecked: results.filter((r) => !isMissing(r.status) && (r.status >= 400 || r.status === 0)),
  };
}

// ---------- badge ----------

const COLORS = { ok: "#20A795", warn: "#E59426", error: "#D92D20" };

async function paintBadge(tabId, state) {
  const hops = chainOf(state);
  if (!hops.length) return;
  const { redirects, level } = analyzeChain(hops);
  const last = hops[hops.length - 1];
  let text = redirects ? String(redirects) : "";
  if (last.status >= 400) text = String(last.status);
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: COLORS[level] });
    await chrome.action.setBadgeTextColor?.({ tabId, color: "#FFFFFF" });
  } catch {
    // The tab closed in the meantime.
  }
}

// ---------- domain checker ----------
//
// The domains page (src/domains.js) sends a list over a port; each domain gets two requests from
// here, without cookies: http://domain/ (the chain, where it ends up, the start of its page) and
// https://domain/ (does HTTPS work). webRequest sees this worker's own requests (tabId -1), which
// is how the hops are known: fetch only tells where a chain ended.

const CHECK_FILTER = { urls: ["http://*/*", "https://*/*"], types: ["xmlhttprequest"] };
const CHECK_CONCURRENCY = 6;
const CHECK_TIMEOUT_MS = 15000;
const PAGE_SAMPLE_BYTES = 150_000;

/** Traces waiting for their first request, by URL; then by requestId. */
const awaitingTrace = new Map();
const traces = new Map();

chrome.webRequest.onBeforeRequest.addListener((details) => {
  if (details.tabId !== -1 || traces.has(details.requestId)) return;
  const trace = awaitingTrace.get(details.url);
  if (!trace) return;
  awaitingTrace.delete(details.url);
  traces.set(details.requestId, trace);
}, CHECK_FILTER);

chrome.webRequest.onBeforeRedirect.addListener((details) => {
  const trace = traces.get(details.requestId);
  if (trace && !trace.done) trace.hops.push({ url: details.url, status: details.statusCode, to: details.redirectUrl });
}, CHECK_FILTER);

chrome.webRequest.onErrorOccurred.addListener((details) => {
  const trace = traces.get(details.requestId);
  traces.delete(details.requestId);
  if (trace && !trace.done) trace.error = details.error;
}, CHECK_FILTER);

chrome.webRequest.onCompleted.addListener((details) => traces.delete(details.requestId), CHECK_FILTER);

const until = async (test, ms) => {
  for (const end = Date.now() + ms; !test() && Date.now() < end;) await new Promise((r) => setTimeout(r, 25));
};

async function readSample(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  while (text.length < PAGE_SAMPLE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return text;
}

/** One request, followed to its end, with every hop it went through. */
async function tracedFetch(url, { sample }) {
  const trace = { hops: [], final: null, error: null, done: false };
  awaitingTrace.set(url, trace);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  const started = performance.now();
  let html = "";
  try {
    const response = await fetch(url, { credentials: "omit", cache: "no-store", redirect: "follow", signal: controller.signal });
    // The redirect events may still be on their way.
    await until(() => !response.redirected || trace.hops.at(-1)?.to === response.url, 500);
    trace.final = { url: response.url, status: response.status };
    html = sample ? await readSample(response) : "";
    if (!sample) response.body?.cancel().catch(() => {});
  } catch {
    if (controller.signal.aborted) {
      trace.error = "net::ERR_TIMED_OUT";
    } else {
      // The error itself (no DNS, a certificate) comes with webRequest's event.
      await until(() => trace.error, 500);
      trace.error ||= "net::ERR_FAILED";
    }
  } finally {
    trace.done = true;
    clearTimeout(timer);
    awaitingTrace.delete(url);
  }
  return { hops: trace.hops, final: trace.final, error: trace.final ? null : trace.error, html, ms: Math.round(performance.now() - started) };
}

async function checkDomain(domain) {
  const http = await tracedFetch(`http://${domain}/`, { sample: true });
  const https = await tracedFetch(`https://${domain}/`, { sample: false });
  const httpsResult = { status: https.final?.status, error: https.error };
  const verdict = classify({ domain, http, https: httpsResult, html: http.html });
  return { domain, ...verdict, hops: http.hops.map(({ url, status }) => ({ url, status })), final: http.final, https: httpsResult, ms: http.ms };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "domain-check") return;
  let stopped = false;
  port.onDisconnect.addListener(() => (stopped = true));
  port.onMessage.addListener(async ({ domains }) => {
    const queue = [...domains];
    const results = [];
    const at = Date.now();
    async function worker() {
      while (queue.length && !stopped) {
        const result = await checkDomain(queue.shift());
        results.push(result);
        if (!stopped) port.postMessage({ type: "result", result, done: results.length, total: domains.length });
      }
    }
    await Promise.all(Array.from({ length: CHECK_CONCURRENCY }, worker));
    // Keep the run in the order it was asked for, for the next time the page opens.
    const order = new Map(domains.map((domain, i) => [domain, i]));
    results.sort((a, b) => order.get(a.domain) - order.get(b.domain));
    await chrome.storage.local.set({ domainCheck: { at, complete: !stopped, results } });
    if (!stopped) port.postMessage({ type: "finished" });
  });
});

// ---------- the RedirHub connection ----------
//
// The options page signs in (src/connect.js) and hands the tokens here. Every call to RedirHub
// goes through `call`, which refreshes the access token when it is about to expire. A refused
// refresh or token ends the connection: the user connects again.

/** The access token to use now, refreshed first when it expires within a minute. */
function freshAccess() {
  return update("local", "auth", async (auth) => {
    if (!auth) throw new Error("Connect your RedirHub account first.");
    if (!needsRefresh(auth.tokens)) return auth;
    const { oauthClient } = await chrome.storage.local.get("oauthClient");
    try {
      const tokens = await refreshTokens({ token_endpoint: oauthClient.tokenEndpoint }, { clientId: oauthClient.id, refresh: auth.tokens.refresh });
      return { ...auth, tokens };
    } catch {
      return undefined;
    }
  }).then((auth) => {
    if (!auth) throw new Error("Your RedirHub connection ended. Connect again.");
    return auth.tokens.access;
  });
}

/** Calls one RedirHub MCP tool as the connected user. */
async function call(name, args) {
  try {
    return await callTool(await freshAccess(), name, args);
  } catch (error) {
    if (error.unauthorized) await chrome.storage.local.remove("auth");
    throw error;
  }
}

// ---------- messages from the popup, options page and content script ----------

const handlers = {
  async "meta-refresh"(message, sender) {
    const tabId = sender.tab?.id;
    if (tabId == null) return;
    await update("session", tabKey(tabId), (state = { segments: [], commits: [], meta: {} }) => {
      state.meta = { ...Object.fromEntries(Object.entries(state.meta || {}).slice(-9)), [message.url]: { delay: message.delay, target: message.target } };
      return state;
    });
  },
  async "get-chain"({ tabId }) {
    const state = (await chrome.storage.session.get(tabKey(tabId)))[tabKey(tabId)];
    const hops = chainOf(state);
    return { hops, analysis: analyzeChain(hops) };
  },
  async "get-not-found"({ host }) {
    return { items: await notFoundFor(host), settings: await settings() };
  },
  async "remove-not-found"({ host, urls }) {
    await update("local", `nf:${host}`, (list = {}) => {
      urls.forEach((url) => delete list[url]);
      return Object.keys(list).length ? list : undefined;
    });
  },
  "scan-links": ({ tabId }) => scanLinks(tabId),
  async "set-settings"({ settings: patch }) {
    await update("local", "settings", (current = {}) => ({ ...current, ...patch }));
  },
  async "get-auth"() {
    const { auth } = await chrome.storage.local.get("auth");
    return { account: auth?.account || null };
  },
  async "signed-in"({ tokens }) {
    const account = await getAccount((name, args) => callTool(tokens.access, name, args));
    await chrome.storage.local.set({ auth: { tokens, account } });
    return { account };
  },
  async "sign-out"() {
    await chrome.storage.local.remove("auth");
  },
  async "save-redirects"({ rules, note }) {
    const { auth } = await chrome.storage.local.get("auth");
    if (!auth) return { needsSignIn: true };
    return { results: await saveRedirects(call, rules, note) };
  },
  async "clear-data"() {
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("nf:") || k.startsWith("live:") || k === "domainCheck"));
  },
};

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  Promise.resolve(handler(message, sender))
    .then((result) => reply({ ok: true, ...(result || {}) }))
    .catch((error) => reply({ ok: false, error: error.message || String(error) }));
  return true;
});
