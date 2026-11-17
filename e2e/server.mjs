// A test site for the extension, on one port that speaks HTTP and HTTPS: acme-shop.test with a
// redirect chain, client redirects and 404s; api.test, a stand-in for the RedirHub API that keeps
// the real API's rules; dashboard.test, a stand-in for the dashboard's connect page. Chromium maps
// *.test to this port (see run.mjs).
//   E2E_PORT=8443 node e2e/server.mjs
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PORT = Number(process.env.E2E_PORT || 8443);
export const TOKEN = "test-token";

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

/** The stand-in API's links, by id. */
const links = new Map();

function api(req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const json = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { message: "Unauthenticated." });
    if (req.method === "GET" && req.url === "/v1/account") {
      return json(200, { id: "user_test", name: "Kris Brown", email: "kris@acme-shop.test", current_workspace: "a33fd9f1-546b-478b-addb-daa9b81d678d" });
    }
    if (req.method === "GET" && req.url === "/v1/workspace/current") {
      return json(200, { data: { id: "a33fd9f1-546b-478b-addb-daa9b81d678d", name: "Acme Shop" } });
    }
    const url = new URL(req.url, "https://api.test");
    if (req.method === "GET" && url.pathname === "/v1/links") {
      const search = url.searchParams.get("filter[search]") || "";
      return json(200, { data: [...links.values()].filter((link) => link.url.includes(search)) });
    }
    if (req.method === "POST" && url.pathname === "/v1/links") {
      const link = JSON.parse(body);
      // As the real API: a redirect's source URL carries its host, and a source has one link.
      if ("host" in link) return json(422, { message: "The host field is prohibited.", errors: { host: ["The host field is prohibited."] } });
      if ([...links.values()].some((other) => other.url === link.url)) return json(400, { message: `Record already exists ${link.url}` });
      const saved = { id: `link_${Math.random().toString(36).slice(2, 8)}`, ...link };
      links.set(saved.id, saved);
      console.log("API POST /v1/links", JSON.stringify(link));
      return json(200, { data: [saved] });
    }
    const id = url.pathname.match(/^\/v1\/links\/(link_\w+)$/)?.[1];
    if (req.method === "PUT" && links.has(id)) {
      const saved = { ...links.get(id), ...JSON.parse(body) };
      links.set(id, saved);
      console.log(`API PUT /v1/links/${id}`, body);
      return json(200, saved);
    }
    json(404, { message: "Not found" });
  });
}

/** The dashboard's /connect/extension page, reduced to its handshake (redirhub/lviv, src/lib/extensionConnect.ts). */
const CONNECT_PAGE = `<!doctype html><meta charset="utf-8"><title>Connect</title>
<body style="font:16px system-ui;padding:40px"><h1>Connect the browser extension</h1>
<p id="state-line">Looking for the extension…</p><button id="allow" disabled>Connect</button>
<script>
const state = new URLSearchParams(location.search).get("state");
const line = document.getElementById("state-line");
addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "extension") return;
  if (e.data.type === "hello") { allow.disabled = false; line.textContent = "Ready"; }
  if (e.data.type === "connected") line.textContent = "Connected as " + e.data.name + " in " + e.data.workspace;
  if (e.data.type === "failed") line.textContent = "Failed: " + e.data.error;
});
postMessage({ source: "dashboard", type: "ping" }, location.origin);
allow.onclick = () => postMessage({ source: "dashboard", type: "token", state, token: "${TOKEN}" }, location.origin);
</script>`;

function dashboard(req, res) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(CONNECT_PAGE);
}

function route(req, res) {
  const host = req.headers.host || "";
  if (host.startsWith("api.test")) return api(req, res);
  if (host.startsWith("dashboard.test")) return dashboard(req, res);
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
