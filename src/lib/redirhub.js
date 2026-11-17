// The RedirHub API, signed in with the user's API token.

import { linkBody } from "./rules.js";

export const API_BASE = "https://api.redirhub.com/v1";
export const URL_API_TOKENS = "https://account.redirhub.com/user/api-tokens";
export const URL_REGISTER = "https://dash.redirhub.com/login";
export const URL_DASHBOARD = "https://dash.redirhub.com";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(token, path, init = {}) {
  let response;
  try {
    response = await fetch(API_BASE + path, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new ApiError("RedirHub could not be reached. Check your connection.", 0);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.errors ? Object.values(body.errors).flat()[0] : null;
    throw new ApiError(detail || body.message || `RedirHub answered ${response.status}`, response.status);
  }
  return body;
}

export async function getAccount(token) {
  const account = await call(token, "/account");
  const workspace = account.current_workspace;
  return {
    name: account.name,
    email: account.email,
    workspace: workspace && typeof workspace === "object" ? workspace.name : null,
  };
}

/** Creates one redirect per rule; a failure does not stop the others. */
export async function createRedirects(token, rules, note) {
  const results = [];
  for (const rule of rules) {
    try {
      const body = await call(token, "/links", { method: "POST", body: JSON.stringify(linkBody(rule, note)) });
      results.push({ rule, ok: true, id: body.data?.[0]?.id });
    } catch (error) {
      results.push({ rule, ok: false, error: error.message });
    }
  }
  return results;
}
