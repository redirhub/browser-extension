// Reads a traced redirect chain and says what is wrong with it.
//
// A chain is a list of hops in the order the browser followed them. Every hop
// but the last is a redirect; the last is the page the browser landed on.
//
//   { url, status, kind, to?, server?, ms?, cached?, error? }
//
// kind: "server" (an HTTP 3xx), "browser" (Chrome's own HTTP -> HTTPS upgrade
// for HSTS, never sent over the network), "meta" (meta refresh), "js"
// (JavaScript navigation) or "final" (the last hop).

const PERMANENT = new Set([301, 308]);
const TEMPORARY = new Set([302, 303, 307]);

/** The hops that count as redirects: everything a server or the page asked for. */
export function redirectHops(hops) {
  return hops.slice(0, -1).filter((hop) => hop.kind !== "browser");
}

export function statusLabel(hop) {
  if (hop.kind === "meta") return "Meta";
  if (hop.kind === "js") return "JS";
  if (hop.kind === "browser") return "HSTS";
  if (hop.error) return "Error";
  return String(hop.status);
}

export function statusText(hop) {
  if (hop.kind === "meta") return "Meta refresh";
  if (hop.kind === "js") return "JavaScript redirect";
  if (hop.kind === "browser") return "Browser HTTPS upgrade";
  if (hop.error) return hop.error;
  const names = {
    200: "OK", 301: "Moved permanently", 302: "Found (temporary)", 303: "See other",
    304: "Not modified", 307: "Temporary redirect", 308: "Permanent redirect",
    400: "Bad request", 401: "Unauthorized", 403: "Forbidden", 404: "Not found",
    410: "Gone", 429: "Too many requests", 500: "Server error", 502: "Bad gateway",
    503: "Service unavailable", 504: "Gateway timeout",
  };
  return names[hop.status] || "";
}

/** "ok" | "warn" | "error" for one hop, used for its colour. */
export function hopTone(hop) {
  if (hop.error || hop.status >= 400) return "error";
  if (hop.kind === "meta" || hop.kind === "js") return "warn";
  if (hop.kind === "browser") return "muted";
  if (TEMPORARY.has(hop.status)) return "warn";
  if (PERMANENT.has(hop.status)) return "redirect";
  return "ok";
}

function sameDocument(a, b) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host === y.host && x.pathname === y.pathname && x.search === y.search && x.protocol === y.protocol;
  } catch {
    return a === b;
  }
}

/**
 * Analyse a chain.
 *
 * Returns the number of redirects, the issues found (worst first), the overall
 * level and, when the chain should be one rule, the rule that replaces it.
 */
export function analyzeChain(hops) {
  const issues = [];
  if (!hops || hops.length === 0) {
    return { redirects: 0, issues, level: "ok", fix: null };
  }

  const first = hops[0];
  const last = hops[hops.length - 1];
  const redirects = redirectHops(hops);

  const seen = new Set();
  let loop = /TOO_MANY_REDIRECTS/.test(last.error || "");
  for (const hop of hops.slice(0, -1)) {
    const key = hop.url;
    if (seen.has(key)) loop = true;
    seen.add(key);
  }
  if (loop) {
    issues.push({
      level: "error",
      code: "loop",
      title: "Redirect loop",
      text: "The chain comes back to a URL it already visited, so the page never loads.",
    });
  }

  if (last.error && !loop) {
    issues.push({ level: "error", code: "failed", title: "The page did not load", text: last.error });
  } else if (last.status >= 400) {
    const missing = last.status === 404 || last.status === 410;
    let text;
    if (missing) {
      text = redirects.length
        ? "Visitors are redirected to a page that does not exist. Point the redirect at a live page."
        : "This page does not exist. Redirect it to the closest live page.";
    } else {
      text = `The server answered ${last.status} ${statusText(last)}`.trim() + ", so visitors see an error instead of the page.";
    }
    issues.push({ level: "error", code: missing ? "missing" : "broken", title: `Ends at a ${last.status}`, text });
  }

  for (let i = 0; i < hops.length - 1; i++) {
    const from = hops[i];
    const to = hops[i + 1];
    if (from.url.startsWith("https:") && to.url.startsWith("http:")) {
      issues.push({
        level: "error",
        code: "downgrade",
        title: "Drops from HTTPS to HTTP",
        text: `${shortUrl(from.url)} sends visitors to an insecure URL.`,
      });
      break;
    }
  }

  if (redirects.length >= 2) {
    issues.push({
      level: "warn",
      code: "chain",
      title: `${redirects.length} redirects in a row`,
      text: "Every hop adds a round trip and search engines may stop following long chains. Send the first URL straight to the final page.",
    });
  }

  const temporary = redirects.filter((hop) => hop.kind === "server" && TEMPORARY.has(hop.status));
  if (temporary.length) {
    const codes = [...new Set(temporary.map((hop) => hop.status))].join(", ");
    issues.push({
      level: "warn",
      code: "temporary",
      title: `Temporary redirect (${codes})`,
      text: "Search engines keep the old URL indexed. If the move is permanent, use a 301.",
    });
  }

  const client = redirects.filter((hop) => hop.kind === "meta" || hop.kind === "js");
  if (client.length) {
    const kinds = [...new Set(client.map((hop) => (hop.kind === "meta" ? "meta refresh" : "JavaScript")))].join(" and ");
    issues.push({
      level: "warn",
      code: "client",
      title: `Client-side redirect (${kinds})`,
      text: "The page loads first and then moves on. It is slower and not every crawler follows it. Use a server-side 301.",
    });
  }

  const level = issues.some((issue) => issue.level === "error")
    ? "error"
    : issues.length
      ? "warn"
      : "ok";

  let fix = null;
  const lands = !last.error && last.status >= 200 && last.status < 300;
  if (redirects.length && lands && level !== "ok" && !sameDocument(first.url, last.url)) {
    fix = { source: first.url, destination: last.url, type: "301" };
  } else if (last.status === 404 || last.status === 410) {
    fix = { source: redirects.length ? first.url : last.url, destination: null, type: "301" };
  }

  return { redirects: redirects.length, issues, level, fix };
}

/** host + path for display; the scheme shows only when it is plain HTTP. */
export function shortUrl(url) {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" ? "http://" : "") + u.host + (u.pathname === "/" && !u.search ? "" : u.pathname) + u.search;
  } catch {
    return url;
  }
}
