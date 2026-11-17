// Turns redirect rules into what RedirHub imports: a CSV for the dashboard's
// bulk import, or the body of POST /v1/links for one rule.

/** "https://www.example.com/old?x=1" -> "www.example.com/old?x=1", the source format RedirHub takes. */
export function sourceOf(url) {
  const u = new URL(url);
  const path = u.pathname === "/" && !u.search ? "" : u.pathname + u.search;
  return u.host + path;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** rules: [{ source, destination, type }] with absolute URLs, in the columns of RedirHub's import template. */
export function rulesToCsv(rules) {
  const lines = ["source URL,destination,type"];
  for (const rule of rules) {
    lines.push([sourceOf(rule.source), rule.destination, rule.type || "301"].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

/** The body of POST /v1/links for a redirect: the source URL carries its host (a `host` field is refused). */
export function linkBody(rule, note) {
  return {
    handler: "redirect",
    url: sourceOf(rule.source),
    destination: rule.destination,
    type: rule.type || "301",
    note,
  };
}
