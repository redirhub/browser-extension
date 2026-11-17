/** The stand-in domain portfolio of server.mjs, one domain per verdict; gone-domain.test has no DNS (run.mjs). */
export const PORTFOLIO = ["live-widgets.test", "old-brand.test", "premium-name.test", "ads-parked.test", "rate-limited.test", "broken-shop.test", "plain-http.test", "gone-domain.test"];

/** The verdict the domain checker must give each of them. */
export const EXPECTED = {
  "live-widgets.test": "Live site",
  "old-brand.test": "Forwards",
  "premium-name.test": "For sale",
  "ads-parked.test": "Parked",
  "rate-limited.test": "Could not check",
  "broken-shop.test": "Error",
  "plain-http.test": "Live site",
  "gone-domain.test": "No DNS",
};
