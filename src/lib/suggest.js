// Picks the most likely destination for a URL that answered 404, from the
// live pages of the same site the extension has seen.

const STOP = new Set(["html", "htm", "php", "aspx", "asp", "index", "www", "the", "and", "a", "of"]);

export function pathTokens(path) {
  return decodeURIComponent(path)
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, "")
    .split(/[/\-_.+\s]+/)
    .filter((token) => token && !STOP.has(token));
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** Token similarity where "widgets" and "widget" still count as a match. */
function tokenMatch(a, b) {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest < 4) return 0;
  const ratio = 1 - levenshtein(a, b) / longest;
  return ratio >= 0.75 ? ratio : 0;
}

/**
 * How alike two paths are, from 0 to 1. Sharing a folder is not enough: some
 * word of the page's own name (its last segment) has to match too.
 */
export function similarity(pathA, pathB) {
  const a = pathTokens(pathA);
  const b = pathTokens(pathB);
  if (!a.length || !b.length) return 0;
  const name = pathTokens(pathA.split("/").filter(Boolean).pop() || "");
  if (!name.some((token) => b.some((other) => tokenMatch(token, other) > 0))) return 0;
  let matched = 0;
  for (const token of a) {
    let best = 0;
    for (const other of b) best = Math.max(best, tokenMatch(token, other));
    matched += best;
  }
  const union = a.length + b.length - matched;
  let score = matched / union;
  const segA = pathA.split("/").filter(Boolean);
  const segB = pathB.split("/").filter(Boolean);
  if (segA[0] && segA[0] === segB[0]) score += 0.1;
  return Math.min(score, 1);
}

function parentPaths(path) {
  const segments = path.split("/").filter(Boolean);
  const parents = [];
  for (let i = segments.length - 1; i > 0; i--) {
    parents.push("/" + segments.slice(0, i).join("/") + "/");
    parents.push("/" + segments.slice(0, i).join("/"));
  }
  return parents;
}

/**
 * @param {string} brokenUrl the URL that answered 404
 * @param {string[]} livePaths paths of the same host that answered 2xx
 * @returns {{ url: string, reason: "similar" | "parent" | "home", score: number }}
 */
export function suggestDestination(brokenUrl, livePaths) {
  const broken = new URL(brokenUrl);
  const origin = broken.origin;
  const candidates = [...new Set(livePaths)].filter((path) => path !== broken.pathname);

  let best = null;
  for (const path of candidates) {
    if (path === "/") continue;
    const score = similarity(broken.pathname, path);
    if (!best || score > best.score || (score === best.score && path.length < best.path.length)) {
      best = { path, score };
    }
  }
  if (best && best.score >= 0.34) {
    return { url: origin + best.path, reason: "similar", score: best.score };
  }

  const live = new Set(candidates);
  for (const parent of parentPaths(broken.pathname)) {
    if (live.has(parent)) return { url: origin + parent, reason: "parent", score: 0 };
  }
  return { url: origin + "/", reason: "home", score: 0 };
}
