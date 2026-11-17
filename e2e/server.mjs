// A test site for the extension, on one port that speaks HTTP and HTTPS: acme-shop.test with a
// redirect chain, client redirects and 404s, and stand-ins for RedirHub's sign-in (account.test)
// and MCP server (api.test). Chromium maps *.test to this port (see run.mjs).
//   E2E_PORT=8443 node e2e/server.mjs
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PORTFOLIO } from "./portfolio.mjs";

export const PORT = Number(process.env.E2E_PORT || 8443);

const dir = join(import.meta.dirname, ".cert");
if (!existsSync(join(dir, "key.pem"))) {
  mkdirSync(dir, { recursive: true });
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30", "-subj", "/CN=acme-shop.test",
    "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")], { stdio: "ignore" });
}

const LIVE = {
  "/": "Home",
  "/products/": "All products",
  "/products/blue-widget": "Blue widget",
  "/products/red-widget": "Red widget",
  "/blog/": "Blog",
  "/blog/how-to-fix-redirect-chains": "How to fix redirect chains",
  "/about": "About us",
  "/contact": "Contact",
  "/pricing": "Pricing",
  "/sale/summer-2026": "Summer sale 2026",
};

const BLOG_LINKS = [
  ["/blog/how-to-fix-redirect-chains", "How to fix redirect chains"],
  ["/blog/redirect-chains-guide", "The redirect chains guide (old link)"],
  ["/products/blue-widgets", "Shop blue widgets"],
  ["/contact-us", "Contact us"],
  ["/team", "Meet the team"],
  ["/about", "About"],
  ["/pricing", "Pricing"],
  ["/old-pricing.php", "Old price list"],
];

function page(title, body = "", head = "") {
  const nav = ["/", "/products/", "/blog/", "/pricing", "/about", "/contact"].map((p) => `<a href="${p}">${LIVE[p]}</a>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} · Acme Shop</title>${head}
<style>body{margin:0;font:16px/1.5 Georgia,serif;color:#1d2433;background:#fbfaf7}header{background:#1d2433;color:#fff;padding:18px 48px;display:flex;gap:28px;align-items:center}
header b{font:700 20px system-ui;margin-right:24px}header a{color:#d7dbe4;text-decoration:none;font:15px system-ui}main{padding:48px;max-width:760px}h1{font-size:40px;margin:0 0 12px}
.hero{height:220px;border-radius:16px;background:linear-gradient(120deg,#f6c26b,#ef8a5b 60%,#c8576e);margin:24px 0}.links a{display:block;padding:8px 0;color:#1C6DB6}</style></head>
<body><header><b>ACME SHOP</b>${nav}</header><main><h1>${title}</h1>${body}</main></body></html>`;
}

function site(req, res) {
  const url = new URL(req.url, `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`);
  const host = url.host;
  const go = (status, location, headers = {}) => { res.writeHead(status, { Location: location, ...headers }); res.end(); };
  const html = (status, body) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", Server: "nginx" }); res.end(body); };

  // A chain of four: HTTP -> HTTPS -> www (302) -> new path -> meta refresh.
  if (url.protocol === "http:") return go(301, `https://${host}${url.pathname}${url.search}`, { Server: "nginx" });
  if (host === "acme-shop.test") return go(302, `https://www.acme-shop.test${url.pathname}${url.search}`, { Server: "Apache" });
  if (url.pathname === "/summer-sale") return go(301, "/sale/summer/", { Server: "nginx", "X-Redirect-By": "WordPress" });
  if (url.pathname === "/sale/summer/") {
    return html(200, page("Moving you to the summer sale…", "<p>This page has moved.</p>", '<meta http-equiv="refresh" content="0; url=/sale/summer-2026">'));
  }
  if (url.pathname === "/go/promo") {
    return html(200, page("One moment…", "", "<script>setTimeout(() => location.replace('/sale/summer-2026'), 50)</script>"));
  }
  if (url.pathname === "/team") return go(301, "/about", { Server: "nginx" });
  if (url.pathname === "/blog/") {
    return html(200, page("Blog", `<p>Notes from the Acme team.</p><div class="links">${BLOG_LINKS.map(([href, text]) => `<a href="${href}">${text}</a>`).join("")}</div>`));
  }
  if (LIVE[url.pathname]) {
    return html(200, page(LIVE[url.pathname], `<div class="hero"></div><p>Hand-made widgets, shipped worldwide.</p>`));
  }
  return html(404, page("Page not found", "<p>Sorry, we could not find that page.</p>"));
}

// ---------- stand-ins for RedirHub: an OAuth authorization server and the MCP server ----------
//
// account.test signs in as RedirHub's does (redirhub/backend, app/Mcp): discovery, dynamic
// registration, a consent screen, authorization code with PKCE (S256 checked), refresh tokens.
// api.test answers MCP tools/call with the tools the extension uses, keeping the real server's
// rules: one link per source ("Record already exists"), errors as isError results.

const clients = new Map();
const codes = new Map();
const tokens = new Map();
/** The stand-in workspace's links, by id. */
const links = new Map();

const s256 = (value) => createHash("sha256").update(value).digest("base64url");
const issue = () => {
  const access = `access_${randomBytes(12).toString("hex")}`;
  const refresh = `refresh_${randomBytes(12).toString("hex")}`;
  tokens.set(access, refresh);
  return { token_type: "Bearer", access_token: access, refresh_token: refresh, expires_in: 3600 };
};

function readBody(req) {
  return new Promise((done) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => done(body));
  });
}

const json = (res, status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };

async function account(req, res) {
  const url = new URL(req.url, "https://account.test");
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    return json(res, 200, {
      issuer: "https://account.test",
      authorization_endpoint: "https://account.test/oauth/authorize",
      token_endpoint: "https://account.test/oauth/token",
      registration_endpoint: "https://account.test/oauth/register",
      code_challenge_methods_supported: ["S256"],
    });
  }
  if (url.pathname === "/oauth/register" && req.method === "POST") {
    const client = JSON.parse(await readBody(req));
    const id = `client_${randomBytes(6).toString("hex")}`;
    clients.set(id, client);
    return json(res, 201, { client_id: id, ...client });
  }
  if (url.pathname === "/oauth/authorize") {
    const q = Object.fromEntries(url.searchParams);
    const client = clients.get(q.client_id);
    if (!client?.redirect_uris.includes(q.redirect_uri) || q.code_challenge_method !== "S256") return json(res, 400, { error: "invalid_request" });
    const code = `code_${randomBytes(8).toString("hex")}`;
    codes.set(code, { challenge: q.code_challenge, clientId: q.client_id, redirectUri: q.redirect_uri });
    const back = (params) => `${q.redirect_uri}?${new URLSearchParams({ ...params, state: q.state })}`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Connect</title><body style="font:16px system-ui;padding:40px">
      <h1>${client.client_name} wants to connect</h1><p>Scopes: ${q.scope}</p>
      <a id="deny" href="${back({ error: "access_denied" })}">Cancel</a> <a id="allow" href="${back({ code })}">Allow access</a>`);
  }
  if (url.pathname === "/oauth/token" && req.method === "POST") {
    const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
    if (form.grant_type === "authorization_code") {
      const grant = codes.get(form.code);
      codes.delete(form.code);
      if (!grant || grant.clientId !== form.client_id || grant.redirectUri !== form.redirect_uri || s256(form.code_verifier || "") !== grant.challenge) {
        return json(res, 400, { error: "invalid_grant" });
      }
      return json(res, 200, issue());
    }
    if (form.grant_type === "refresh_token") {
      const access = [...tokens].find(([, refresh]) => refresh === form.refresh_token)?.[0];
      if (!access) return json(res, 400, { error: "invalid_grant" });
      tokens.delete(access);
      console.log("OAuth refresh: the old access token stops working");
      return json(res, 200, issue());
    }
    return json(res, 400, { error: "unsupported_grant_type" });
  }
  json(res, 404, { message: "Not found" });
}

const TOOLS = {
  "get-account": () => ({ id: "user_test", name: "Kris Brown", email: "kris@acme-shop.test" }),
  "get-workspace": () => ({ uuid: "a33fd9f1-546b-478b-addb-daa9b81d678d", name: "Acme Shop" }),
  "list-links": ({ search = "" }) => ({ data: [...links.values()].filter((link) => link.url.includes(search)), has_more: false }),
  "create-redirect": (args) => {
    if ([...links.values()].some((link) => link.url === args.url)) throw new Error(`Record already exists ${args.url}`);
    const link = { id: `link_${randomBytes(4).toString("hex")}`, handler: "redirect", ...args };
    links.set(link.id, link);
    console.log("MCP create-redirect", JSON.stringify(args));
    return link;
  },
  "update-link": ({ id, ...change }) => {
    if (!links.has(id)) throw new Error(`No link ${id}`);
    links.set(id, { ...links.get(id), ...change });
    console.log("MCP update-link", id, JSON.stringify(change));
    return links.get(id);
  },
};

async function api(req, res) {
  const url = new URL(req.url, "https://api.test");
  if (url.pathname === "/.well-known/oauth-protected-resource") {
    return json(res, 200, { resource: "https://api.test", authorization_servers: ["https://account.test"], scopes_supported: ["links:read", "links:write"] });
  }
  const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (!tokens.has(bearer)) {
    res.writeHead(401, { "WWW-Authenticate": 'Bearer resource_metadata="https://api.test/.well-known/oauth-protected-resource"' });
    return res.end();
  }
  const rpc = JSON.parse(await readBody(req));
  const tool = TOOLS[rpc.params?.name];
  if (rpc.method !== "tools/call" || !tool) return json(res, 200, { jsonrpc: "2.0", id: rpc.id, error: { code: -32602, message: "Unknown tool" } });
  try {
    const value = tool(rpc.params.arguments || {});
    return json(res, 200, { jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(value) }], isError: false, structuredContent: value } });
  } catch (error) {
    return json(res, 200, { jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: error.message }], isError: true } });
  }
}

// ---------- a stand-in domain portfolio, one domain per verdict of the domain checker ----------

const lander = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;padding:40px">${body}`;

function portfolio(req, res) {
  const host = (req.headers.host || "").split(":")[0];
  const secure = req.socket.encrypted;
  const go = (status, location) => { res.writeHead(status, { Location: location, Server: "nginx" }); res.end(); };
  const page = (status, html) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", Server: "nginx" }); res.end(html); };
  switch (host) {
    case "live-widgets.test":
      return secure ? page(200, lander("Live Widgets", "<h1>Live Widgets</h1><p>Hand-made widgets.</p>")) : go(301, "https://live-widgets.test/");
    case "old-brand.test":
      // A retired brand: a temporary redirect, then to the new site.
      return secure ? go(301, "https://www.acme-shop.test/") : go(302, "https://old-brand.test/");
    case "premium-name.test":
      return secure ? page(200, lander("premium-name.test", "<h1>premium-name.test</h1><p>This domain is for sale. Make an offer.</p>")) : go(301, "https://premium-name.test/");
    case "ads-parked.test":
      return page(200, lander("ads-parked.test", '<h1>ads-parked.test</h1><p>Related searches</p><script src="https://www.parkingcrew.net/assets/lander.js"></script>'));
    case "rate-limited.test":
      // A bot wall: 429 to every request, which says nothing about the site.
      res.writeHead(429, { "Content-Type": "text/html; charset=utf-8", "Retry-After": "60" });
      return res.end(lander("Too many requests", "<h1>Too many requests</h1>"));
    case "broken-shop.test":
      return page(500, lander("Error", "<h1>Internal Server Error</h1>"));
    case "plain-http.test":
      // Answers on HTTP only: HTTPS gets a 404.
      return secure ? page(404, lander("Not found", "Not found")) : page(200, lander("Plain HTTP", "<h1>Plain HTTP</h1>"));
    default:
      return page(404, lander("Not found", "Not found"));
  }
}

function route(req, res) {
  const host = req.headers.host || "";
  if (host.startsWith("api.test")) return api(req, res);
  if (host.startsWith("account.test")) return account(req, res);
  if (PORTFOLIO.includes(host.split(":")[0])) return portfolio(req, res);
  return site(req, res);
}

const tls = { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) };
const plain = http.createServer(route);
const secure = https.createServer(tls, route);
// One port for both: a TLS handshake starts with 0x16.
net.createServer((socket) => {
  socket.once("data", (first) => {
    socket.pause();
    socket.unshift(first);
    (first[0] === 0x16 ? secure : plain).emit("connection", socket);
    process.nextTick(() => socket.resume());
  });
}).listen(PORT, () => console.log(`test site ready on ${PORT}`));
