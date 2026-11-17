// Where the extension finds RedirHub. The end-to-end runs copy the extension with this file
// pointed at a local backend (e2e/build.mjs); nothing else holds an address.

/** The MCP server: the API the extension calls, and where it discovers how to sign in (OAuth). */
export const MCP_URL = "https://mcp.redirhub.com/";
/** Where a new user creates an account. */
export const DASHBOARD_URL = "https://dash.redirhub.com";
/** The account page listing connected apps, where the extension's access is revoked. */
export const URL_CONNECTIONS = "https://account.redirhub.com/mcp";
