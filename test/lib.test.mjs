import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeChain } from "../src/lib/chain.js";
import { suggestDestination } from "../src/lib/suggest.js";
import { linkBody, rulesToCsv } from "../src/lib/rules.js";

const hop = (url, status, kind = "server") => ({ url, status, kind });

test("a single 301 is fine and needs no fix", () => {
  const result = analyzeChain([hop("http://a.com/x", 301), hop("https://a.com/x", 200, "final")]);
  assert.equal(result.redirects, 1);
  assert.equal(result.level, "ok");
  assert.equal(result.fix, null);
});

test("a long chain with a 302 and a meta refresh becomes one 301", () => {
  const result = analyzeChain([
    hop("http://a.com/sale", 301),
    hop("https://a.com/sale", 302),
    hop("https://www.a.com/sale/", 200, "meta"),
    hop("https://www.a.com/sale-2026", 200, "final"),
  ]);
  assert.equal(result.redirects, 3);
  assert.deepEqual(result.issues.map((i) => i.code), ["chain", "temporary", "client"]);
  assert.deepEqual(result.fix, { source: "http://a.com/sale", destination: "https://www.a.com/sale-2026", type: "301" });
});

test("Chrome's own HSTS upgrade is not counted as a redirect", () => {
  const result = analyzeChain([hop("http://a.com/", 307, "browser"), hop("https://a.com/", 200, "final")]);
  assert.equal(result.redirects, 0);
  assert.equal(result.level, "ok");
});

test("loops, downgrades and broken destinations are errors", () => {
  const loop = analyzeChain([hop("https://a.com/1", 301), hop("https://a.com/2", 301), { ...hop("https://a.com/1", 0, "final"), error: "ERR_TOO_MANY_REDIRECTS" }]);
  assert.equal(loop.issues[0].code, "loop");
  const downgrade = analyzeChain([hop("https://a.com/", 301), hop("http://a.com/", 200, "final")]);
  assert.ok(downgrade.issues.some((i) => i.code === "downgrade"));
  const broken = analyzeChain([hop("https://a.com/old", 301), hop("https://a.com/new", 404, "final")]);
  assert.equal(broken.level, "error");
  assert.deepEqual(broken.fix, { source: "https://a.com/old", destination: null, type: "301" });
});

test("a 404 is sent to the most similar live page, else its parent, else home", () => {
  const live = ["/", "/products/", "/products/blue-widget", "/blog/how-to-fix-redirect-chains", "/contact"];
  assert.equal(suggestDestination("https://a.com/products/blue-widgets", live).url, "https://a.com/products/blue-widget");
  assert.equal(suggestDestination("https://a.com/contact-us", live).url, "https://a.com/contact");
  assert.equal(suggestDestination("https://a.com/blog/redirect-chains-guide", live).url, "https://a.com/blog/how-to-fix-redirect-chains");
  assert.deepEqual(suggestDestination("https://a.com/products/zzz-9", live), { url: "https://a.com/products/", reason: "parent", score: 0 });
  assert.equal(suggestDestination("https://a.com/qq", live).reason, "home");
});

test("rules export as RedirHub sources and link bodies", () => {
  const rules = [{ source: "https://www.a.com/old?x=1", destination: "https://www.a.com/new", type: "301" }];
  assert.equal(rulesToCsv(rules), "source,destination,type\nwww.a.com/old?x=1,https://www.a.com/new,301\n");
  assert.deepEqual(linkBody(rules[0], "why"), {
    handler: "redirect", host: "www.a.com", url: "www.a.com/old?x=1", destination: "https://www.a.com/new", type: "301", note: "why",
  });
});
