// Signing in to RedirHub with OAuth 2.1, as MCP clients do: discover the authorization server
// from the MCP server, register as a public client, authorization code with PKCE, refresh tokens.
// The functions here take the values they need; chrome.identity is used by src/connect.js only.

/** The permissions the extension asks for: read and write links, nothing else. */
export const SCOPES = ["links:read", "links:write"];
export const CLIENT_NAME = "RedirHub browser extension";
/** Refresh this long before the access token expires. */
const EXPIRY_MARGIN_MS = 60 * 1000;

export function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomString(byteLength = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** The PKCE challenge of a verifier (S256). */
export async function challengeOf(verifier) {
  return base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

async function getJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error_description || body.message || body.error || `${new URL(url).host} answered ${response.status}`);
  return body;
}

/** The authorization server's metadata, found from the MCP server's protected-resource document. */
export async function discover(mcpUrl) {
  const resource = await getJson(new URL("/.well-known/oauth-protected-resource", mcpUrl));
  const issuer = resource.authorization_servers?.[0];
  if (!issuer) throw new Error("RedirHub did not say where to sign in.");
  return getJson(new URL("/.well-known/oauth-authorization-server", issuer));
}

/** Registers the extension as a public client for its redirect address; returns the client id. */
export async function register(metadata, redirectUri) {
  const client = await getJson(metadata.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: [redirectUri] }),
  });
  return client.client_id;
}

export function authorizeUrl(metadata, { clientId, redirectUri, challenge, state }) {
  const url = new URL(metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** The code in the address the authorization server sent the user back to, checked against the state. */
export function codeFrom(redirectedTo, state) {
  const params = new URL(redirectedTo).searchParams;
  if (params.get("error")) {
    throw new Error(params.get("error") === "access_denied" ? "The connection was cancelled." : params.get("error_description") || params.get("error"));
  }
  if (params.get("state") !== state) throw new Error("The sign-in answer did not match this request. Try again.");
  const code = params.get("code");
  if (!code) throw new Error("RedirHub sent no authorization code.");
  return code;
}

/** Token endpoint answer -> what the extension keeps. */
export function tokensFrom(answer, now = Date.now()) {
  return {
    access: answer.access_token,
    refresh: answer.refresh_token,
    expiresAt: now + (Number(answer.expires_in) || 3600) * 1000,
  };
}

export function needsRefresh(tokens, now = Date.now()) {
  return !tokens?.expiresAt || tokens.expiresAt - EXPIRY_MARGIN_MS <= now;
}

async function tokenRequest(metadata, params) {
  return getJson(metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
}

export async function exchangeCode(metadata, { clientId, redirectUri, code, verifier }) {
  return tokensFrom(await tokenRequest(metadata, {
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier,
  }));
}

export async function refreshTokens(metadata, { clientId, refresh }) {
  return tokensFrom(await tokenRequest(metadata, { grant_type: "refresh_token", client_id: clientId, refresh_token: refresh }));
}
