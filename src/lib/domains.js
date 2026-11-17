// The domain checker's logic: reading a pasted list, recognising parked and for-sale pages, and
// putting one verdict on each domain. The requests themselves are in src/background.js.

export const MAX_DOMAINS = 1000;

/**
 * Hostnames from whatever was pasted: one per line, or separated by commas, spaces or tabs, with
 * or without a scheme, path or port. Lowercased, IDNs in punycode, duplicates dropped.
 * @returns {{ domains: string[], invalid: string[], extra: number }}
 */
export function parseDomains(text) {
  const domains = [];
  const invalid = [];
  const seen = new Set();
  // A "#" at the start of a line or after a space starts a comment.
  const entries = String(text).split(/\r?\n/).flatMap((line) => line.replace(/(^|\s)#.*$/, "").split(/[\s,;]+/));
  for (const raw of entries) {
    const entry = raw.trim().replace(/^["'<(]+|[">)\].]+$/g, "");
    if (!entry) continue;
    let host;
    try {
      host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(entry) ? entry : `http://${entry}`).hostname;
    } catch {
      invalid.push(entry);
      continue;
    }
    if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(host)) {
      invalid.push(entry);
      continue;
    }
    if (seen.has(host)) continue;
    seen.add(host);
    domains.push(host);
  }
  return { domains: domains.slice(0, MAX_DOMAINS), invalid, extra: Math.max(0, domains.length - MAX_DOMAINS) };
}

/**
 * Where parked and for-sale domains end up. `host` matches the final address (or a parent domain
 * of it), `path` narrows it; `kind` is "for-sale" (a marketplace) or "parked" (ads).
 */
const PROVIDERS = [
  { host: "dan.com", name: "Dan", kind: "for-sale" },
  { host: "afternic.com", name: "Afternic", kind: "for-sale" },
  { host: "hugedomains.com", name: "HugeDomains", kind: "for-sale" },
  { host: "atom.com", name: "Atom", kind: "for-sale" },
  { host: "squadhelp.com", name: "Atom", kind: "for-sale" },
  { host: "sav.com", name: "Sav", kind: "for-sale" },
  { host: "buydomains.com", name: "BuyDomains", kind: "for-sale" },
  { host: "domainmarket.com", name: "DomainMarket", kind: "for-sale" },
  { host: "undeveloped.com", name: "Undeveloped", kind: "for-sale" },
  { host: "efty.com", name: "Efty", kind: "for-sale" },
  { host: "godaddy.com", path: "/forsale", name: "GoDaddy", kind: "for-sale" },
  { host: "sedo.com", name: "Sedo", kind: "for-sale" },
  { host: "sedoparking.com", name: "Sedo", kind: "parked" },
  { host: "parkingcrew.net", name: "ParkingCrew", kind: "parked" },
  { host: "bodis.com", name: "Bodis", kind: "parked" },
  { host: "above.com", name: "Above", kind: "parked" },
  { host: "parklogic.com", name: "ParkLogic", kind: "parked" },
  { host: "parkingpage.namecheap.com", name: "Namecheap", kind: "parked" },
];

/** Traces a parking or sales lander leaves in its HTML, checked when the address says nothing. */
const PAGE_SIGNS = [
  { re: /sedoparking\.com/i, name: "Sedo", kind: "parked" },
  { re: /parkingcrew\.net/i, name: "ParkingCrew", kind: "parked" },
  { re: /bodis\.com/i, name: "Bodis", kind: "parked" },
  { re: /parking-lander|parked-content\.godaddy|wsimg\.com\/parking/i, name: "GoDaddy", kind: "parked" },
  { re: /afternic\.com/i, name: "Afternic", kind: "for-sale" },
  { re: /\bdan\.com\b/i, name: "Dan", kind: "for-sale" },
  { re: /this domain (?:name )?(?:is|may be) for sale|buy this domain|make an offer on this domain/i, name: null, kind: "for-sale" },
  { re: /this domain (?:is|has been) parked|parked free,? courtesy of/i, name: null, kind: "parked" },
];

const hostMatches = (host, base) => host === base || host.endsWith(`.${base}`);

/** The parking or sales service behind a final address and page, or null. */
export function detectParking(finalUrl, html = "") {
  let url;
  try {
    url = new URL(finalUrl);
  } catch {
    url = null;
  }
  if (url) {
    for (const provider of PROVIDERS) {
      if (hostMatches(url.hostname, provider.host) && (!provider.path || url.pathname.startsWith(provider.path))) {
        return { name: provider.name, kind: provider.kind };
      }
    }
  }
  const sample = String(html).slice(0, 200_000);
  for (const sign of PAGE_SIGNS) {
    if (sign.re.test(sample)) return { name: sign.name, kind: sign.kind };
  }
  return null;
}

const sameSite = (host, domain) => host === domain || host === `www.${domain}` || `www.${host}` === domain;

const ERRORS = {
  NAME_NOT_RESOLVED: "No DNS record",
  NAME_RESOLUTION_FAILED: "No DNS record",
  CONNECTION_REFUSED: "Connection refused",
  CONNECTION_RESET: "Connection reset",
  CONNECTION_CLOSED: "Connection closed",
  CONNECTION_TIMED_OUT: "Timed out",
  TIMED_OUT: "Timed out",
  ADDRESS_UNREACHABLE: "Unreachable",
  TOO_MANY_REDIRECTS: "Redirect loop",
  CERT_COMMON_NAME_INVALID: "Certificate is for another name",
  CERT_DATE_INVALID: "Certificate expired",
  CERT_AUTHORITY_INVALID: "Untrusted certificate",
  SSL_PROTOCOL_ERROR: "TLS error",
};

/** A readable reason for a network error such as "net::ERR_NAME_NOT_RESOLVED". */
export function errorLabel(error) {
  const code = String(error || "").replace(/^net::ERR_/, "");
  if (ERRORS[code]) return ERRORS[code];
  if (code.startsWith("CERT_")) return "Certificate error";
  if (code.startsWith("SSL_")) return "TLS error";
  return code ? code.toLowerCase().replace(/_/g, " ") : "No answer";
}

export const CATEGORIES = {
  live: "Live site",
  redirect: "Forwards",
  "for-sale": "For sale",
  parked: "Parked",
  broken: "Error",
  "no-dns": "No DNS",
};

/**
 * One verdict per domain.
 * @param {{ domain: string, http: { hops: object[], final?: { url: string, status: number }, error?: string },
 *           https: { status?: number, error?: string }, html?: string }} check
 * @returns {{ category: string, label: string, destination: string|null, provider: object|null, flags: string[] }}
 */
export function classify({ domain, http, https, html }) {
  const flags = [];
  const final = http.final;
  const httpsBroken = Boolean(https.error) || !https.status || https.status >= 400;
  if (https.error && /CERT_|SSL_/.test(https.error)) flags.push(`HTTPS: ${errorLabel(https.error).toLowerCase()}`);
  else if (httpsBroken && final) flags.push(https.error ? `HTTPS: ${errorLabel(https.error).toLowerCase()}` : `HTTPS answers ${https.status}`);

  const servers = (http.hops || []).filter((hop) => hop.status >= 300 && hop.status < 400);
  if (servers.length >= 2) flags.push(`${servers.length} redirects`);
  if (servers.some((hop) => [302, 303, 307].includes(hop.status))) flags.push("Temporary redirect");

  if (!final) {
    const noDns = /NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED/.test(http.error || "") && (!https.error || /NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED/.test(https.error));
    return {
      category: noDns ? "no-dns" : "broken",
      label: noDns ? "Does not resolve" : errorLabel(http.error),
      destination: null,
      provider: null,
      flags: noDns ? [] : flags,
    };
  }

  const finalUrl = new URL(final.url);
  if (finalUrl.protocol === "http:" && sameSite(finalUrl.hostname, domain) && final.status < 400) flags.push("Stays on HTTP");

  const provider = detectParking(final.url, html);
  if (provider) {
    const label = provider.kind === "for-sale"
      ? (provider.name ? `For sale on ${provider.name}` : "For sale: a sales page on the domain")
      : (provider.name ? `Parked with ${provider.name}` : "Parked: an ads page on the domain");
    return { category: provider.kind, label, destination: final.url, provider, flags };
  }
  if (final.status >= 400) {
    return { category: "broken", label: `Answers ${final.status}`, destination: final.url, provider: null, flags };
  }
  if (!sameSite(finalUrl.hostname, domain)) {
    return { category: "redirect", label: `Forwards to ${finalUrl.hostname}`, destination: final.url, provider: null, flags };
  }
  return { category: "live", label: `Live (${final.status})`, destination: final.url, provider: null, flags };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The results as a CSV a spreadsheet opens. */
export function resultsToCsv(results) {
  const lines = ["domain,verdict,detail,final URL,final status,redirects,HTTPS,flags,time ms"];
  for (const r of results) {
    const redirects = (r.hops || []).filter((hop) => hop.status >= 300 && hop.status < 400).map((hop) => hop.status).join(" > ");
    const https = r.https?.error ? errorLabel(r.https.error) : r.https?.status ? String(r.https.status) : "";
    lines.push([r.domain, CATEGORIES[r.category], r.label, r.destination || "", r.final?.status || "", redirects, https, r.flags.join("; "), r.ms ?? ""].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}
