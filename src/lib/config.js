// Where the extension finds RedirHub. The end-to-end runs copy the extension with this file
// pointed at a local backend and dashboard (e2e/build.mjs); nothing else reads addresses.

export const API_BASE = "https://api.redirhub.com/v1";
export const DASHBOARD_URL = "https://dash.redirhub.com";
export const URL_API_TOKENS = "https://account.redirhub.com/user/api-tokens";
