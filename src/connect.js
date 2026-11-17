// Signing in, run from the options page: an extension page stays open while the user is on
// RedirHub's consent screen, where the background service worker could be stopped.

import { MCP_URL } from "./lib/config.js";
import { authorizeUrl, challengeOf, codeFrom, discover, exchangeCode, randomString, register } from "./lib/oauth.js";

/** Opens RedirHub's sign-in and consent screen; the background keeps the tokens it hands back. */
export async function connect() {
  const metadata = await discover(MCP_URL);
  const redirectUri = chrome.identity.getRedirectURL();

  // One registration per install, kept while the address and the server stay the same.
  const { oauthClient: known } = await chrome.storage.local.get("oauthClient");
  const reuse = known && known.redirectUri === redirectUri && known.issuer === metadata.issuer;
  const client = reuse ? known : { id: await register(metadata, redirectUri), redirectUri, issuer: metadata.issuer, tokenEndpoint: metadata.token_endpoint };
  await chrome.storage.local.set({ oauthClient: client });

  const verifier = randomString(48);
  const state = randomString(16);
  const url = authorizeUrl(metadata, { clientId: client.id, redirectUri, challenge: await challengeOf(verifier), state });
  const redirectedTo = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  const code = codeFrom(redirectedTo, state);
  const tokens = await exchangeCode(metadata, { clientId: client.id, redirectUri, code, verifier });

  const answer = await chrome.runtime.sendMessage({ type: "signed-in", tokens });
  if (!answer.ok) throw new Error(answer.error);
  return answer.account;
}
