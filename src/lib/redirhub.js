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

/** The link of the token's workspace that answers for `source` (host and path), or null. */
async function findLink(token, source) {
  const body = await call(token, `/links?filter[search]=${encodeURIComponent(source)}&per_page=50`);
  return (body.data || []).find((link) => link.url === source) || null;
}

/**
 * Saves one redirect per rule: a source the workspace already redirects (say, one hop of the chain
 * is a RedirHub link) is updated, any other is created. A failure does not stop the others.
 */
export async function saveRedirects(token, rules, note) {
  const results = [];
  for (const rule of rules) {
    const body = linkBody(rule, note);
    try {
      const existing = await findLink(token, body.url);
      if (existing) {
        await call(token, `/links/${existing.id}`, { method: "PUT", body: JSON.stringify({ destination: body.destination, type: body.type, note }) });
        results.push({ rule, ok: true, id: existing.id, updated: true });
      } else {
        const created = await call(token, "/links", { method: "POST", body: JSON.stringify(body) });
        results.push({ rule, ok: true, id: created.data?.[0]?.id, updated: false });
      }
    } catch (error) {
      results.push({ rule, ok: false, error: error.message });
    }
  }
  return results;
}
