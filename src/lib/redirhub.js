// The RedirHub API, signed in with the API token the dashboard gave the extension.

import { API_BASE, DASHBOARD_URL } from "./config.js";
import { linkBody } from "./rules.js";

/** The dashboard page that connects the extension (redirhub/lviv, /connect/extension). */
export const CONNECT_PATH = "/connect/extension";
export const URL_REGISTER = `${DASHBOARD_URL}/login`;

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

/** The account and workspace the token belongs to. */
export async function getAccount(token) {
  const [account, workspace] = await Promise.all([call(token, "/account"), call(token, "/workspace/current")]);
  return {
    name: account.name,
    email: account.email,
    workspace: (workspace.data || workspace).name || null,
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
