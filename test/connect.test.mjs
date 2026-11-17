import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeUrl, challengeOf, codeFrom, needsRefresh, SCOPES, tokensFrom } from "../src/lib/oauth.js";
import { resultOf } from "../src/lib/mcp.js";
import { saveRedirects } from "../src/lib/redirhub.js";

const metadata = { authorization_endpoint: "https://account.example.test/oauth/authorize", token_endpoint: "https://account.example.test/oauth/token" };

test("the PKCE challenge is the S256 of the verifier (RFC 7636, appendix B)", async () => {
  assert.equal(await challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("the authorize address asks for a code with PKCE and the links scopes only", () => {
  const url = new URL(authorizeUrl(metadata, { clientId: "c1", redirectUri: "https://abc.chromiumapp.org/", challenge: "ch", state: "st" }));
  assert.equal(url.origin + url.pathname, metadata.authorization_endpoint);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    response_type: "code", client_id: "c1", redirect_uri: "https://abc.chromiumapp.org/",
    scope: "links:read links:write", state: "st", code_challenge: "ch", code_challenge_method: "S256",
  });
  assert.deepEqual(SCOPES, ["links:read", "links:write"]);
});

test("the code is taken only with the state the request sent", () => {
  assert.equal(codeFrom("https://abc.chromiumapp.org/?code=k&state=st", "st"), "k");
  assert.throws(() => codeFrom("https://abc.chromiumapp.org/?code=k&state=other", "st"), /did not match/);
  assert.throws(() => codeFrom("https://abc.chromiumapp.org/?error=access_denied&state=st", "st"), /cancelled/);
  assert.throws(() => codeFrom("https://abc.chromiumapp.org/?state=st", "st"), /no authorization code/);
});

test("tokens are refreshed a minute before they expire", () => {
  const tokens = tokensFrom({ access_token: "a", refresh_token: "r", expires_in: 3600 }, 0);
  assert.deepEqual(tokens, { access: "a", refresh: "r", expiresAt: 3600_000 });
  assert.equal(needsRefresh(tokens, 3_000_000), false);
  assert.equal(needsRefresh(tokens, 3_550_000), true);
  assert.equal(needsRefresh(undefined, 0), true);
});

test("a tool result is its structured content, else its text, and an error throws", () => {
  assert.deepEqual(resultOf({ result: { content: [{ type: "text", text: "{}" }], structuredContent: { id: "link_1" } } }), { id: "link_1" });
  assert.deepEqual(resultOf({ result: { content: [{ type: "text", text: "{\"name\":\"N\"}" }] } }), { name: "N" });
  assert.throws(() => resultOf({ result: { isError: true, content: [{ type: "text", text: "Record already exists a.test/x" }] } }), /Record already exists/);
  assert.throws(() => resultOf({ error: { code: -32602, message: "Unknown tool" } }), /Unknown tool/);
});

test("saving updates the link a source already has and creates the others", async () => {
  const calls = [];
  const links = [{ id: "link_old", url: "a.test/old" }, { id: "link_near", url: "a.test/old-page" }];
  const call = async (name, args) => {
    calls.push([name, args]);
    if (name === "list-links") return { data: links.filter((link) => link.url.includes(args.search)) };
    if (name === "create-redirect") return { id: "link_new" };
    if (name === "update-link") return { id: args.id };
    throw new Error(name);
  };
  const results = await saveRedirects(call, [
    { source: "https://a.test/old", destination: "https://a.test/new", type: "301" },
    { source: "https://a.test/gone", destination: "https://a.test/", type: "301" },
  ], "why");
  assert.deepEqual(results.map((r) => [r.ok, r.id, r.updated]), [[true, "link_old", true], [true, "link_new", false]]);
  assert.deepEqual(calls.filter(([name]) => name !== "list-links"), [
    ["update-link", { id: "link_old", destination: "https://a.test/new", type: "301", note: "why" }],
    ["create-redirect", { url: "a.test/gone", destination: "https://a.test/", type: "301", note: "why" }],
  ]);
});

test("a failed rule does not stop the others", async () => {
  const call = async (name, args) => {
    if (name === "list-links") return { data: [] };
    if (args.url === "a.test/bad") throw new Error("The destination is invalid.");
    return { id: "link_ok" };
  };
  const results = await saveRedirects(call, [
    { source: "https://a.test/bad", destination: "x", type: "301" },
    { source: "https://a.test/good", destination: "https://a.test/", type: "301" },
  ], "why");
  assert.deepEqual(results.map((r) => [r.ok, r.error || r.id]), [[false, "The destination is invalid."], [true, "link_ok"]]);
});
