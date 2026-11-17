import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, detectParking, errorLabel, parseDomains, resultsToCsv } from "../src/lib/domains.js";

test("a pasted list becomes clean, unique hostnames", () => {
  const { domains, invalid } = parseDomains(`
    Example.com
    https://www.example.org/some/page?x=1, shop.example.net:8080
    example.com  "brand.io"  # a comment
    bücher.example
    not a domain, localhost, 999
  `);
  assert.deepEqual(domains, ["example.com", "www.example.org", "shop.example.net", "brand.io", "xn--bcher-kva.example"]);
  assert.deepEqual(invalid, ["not", "a", "domain", "localhost", "999"]);
});

test("a list longer than the limit is cut, and says by how much", () => {
  const text = Array.from({ length: 1005 }, (_, i) => `d${i}.example.com`).join("\n");
  const { domains, extra } = parseDomains(text);
  assert.equal(domains.length, 1000);
  assert.equal(extra, 5);
});

test("parking and sales services are told apart by address, then by page", () => {
  assert.deepEqual(detectParking("https://dan.com/buy-domain/example.com"), { name: "Dan", kind: "for-sale" });
  assert.deepEqual(detectParking("https://www.godaddy.com/forsale/example.com"), { name: "GoDaddy", kind: "for-sale" });
  assert.equal(detectParking("https://www.godaddy.com/"), null);
  assert.deepEqual(detectParking("https://ww25.example.com/", '<script src="//www.parkingcrew.net/x.js">'), { name: "ParkingCrew", kind: "parked" });
  assert.deepEqual(detectParking("https://example.com/", "<h1>This domain is for sale!</h1>"), { name: null, kind: "for-sale" });
  assert.equal(detectParking("https://example.com/", "<h1>Welcome to our bakery</h1>"), null);
});

const hop = (url, status) => ({ url, status });

test("each domain gets one verdict and the flags worth fixing", () => {
  const live = classify({ domain: "example.com", http: { hops: [hop("http://example.com/", 301)], final: { url: "https://example.com/", status: 200 } }, https: { status: 200 } });
  assert.equal(live.category, "live");
  assert.deepEqual(live.flags, []);

  const forwards = classify({
    domain: "old-brand.com",
    http: { hops: [hop("http://old-brand.com/", 302), hop("https://old-brand.com/", 301)], final: { url: "https://www.new-brand.com/", status: 200 } },
    https: { error: "net::ERR_CERT_COMMON_NAME_INVALID" },
  });
  assert.equal(forwards.category, "redirect");
  assert.equal(forwards.label, "Forwards to www.new-brand.com");
  assert.deepEqual(forwards.flags, ["HTTPS: certificate is for another name", "2 redirects", "Temporary redirect"]);

  const forSale = classify({ domain: "idle.com", http: { hops: [hop("http://idle.com/", 302)], final: { url: "https://dan.com/buy-domain/idle.com", status: 200 } }, https: { status: 200 } });
  assert.equal(forSale.label, "For sale on Dan");

  const noDns = classify({ domain: "gone.com", http: { hops: [], error: "net::ERR_NAME_NOT_RESOLVED" }, https: { error: "net::ERR_NAME_NOT_RESOLVED" } });
  assert.deepEqual([noDns.category, noDns.label], ["no-dns", "Does not resolve"]);

  const refused = classify({ domain: "down.com", http: { hops: [], error: "net::ERR_CONNECTION_REFUSED" }, https: { error: "net::ERR_CONNECTION_REFUSED" } });
  assert.deepEqual([refused.category, refused.label], ["broken", "Connection refused"]);

  const plain = classify({ domain: "plain.com", http: { hops: [], final: { url: "http://plain.com/", status: 200 } }, https: { error: "net::ERR_CONNECTION_REFUSED" } });
  assert.deepEqual(plain.flags, ["HTTPS: connection refused", "Stays on HTTP"]);

  const missing = classify({ domain: "x.com", http: { hops: [], final: { url: "http://x.com/", status: 500 } }, https: { status: 500 } });
  assert.deepEqual([missing.category, missing.label, missing.flags], ["broken", "Answers 500", ["HTTPS answers 500"]]);

  const lander = classify({ domain: "nice.com", http: { hops: [], final: { url: "https://nice.com/", status: 200 } }, https: { status: 200 }, html: "This domain is for sale" });
  assert.equal(lander.label, "For sale: a sales page on the domain");
});

test("network errors read as people say them", () => {
  assert.equal(errorLabel("net::ERR_CERT_DATE_INVALID"), "Certificate expired");
  assert.equal(errorLabel("net::ERR_CERT_WEAK_KEY"), "Certificate error");
  assert.equal(errorLabel("net::ERR_EMPTY_RESPONSE"), "empty response");
  assert.equal(errorLabel(undefined), "No answer");
});

test("results export as a CSV", () => {
  const csv = resultsToCsv([{ domain: "old-brand.com", category: "redirect", label: "Forwards to new.com", destination: "https://new.com/", final: { status: 200 }, hops: [hop("http://old-brand.com/", 301)], https: { status: 200 }, flags: ["Temporary redirect"], ms: 120 }]);
  assert.equal(csv, "domain,verdict,detail,final URL,final status,redirects,HTTPS,flags,time ms\nold-brand.com,Forwards,Forwards to new.com,https://new.com/,200,301,200,Temporary redirect,120\n");
});
