// What the extension does in RedirHub, through MCP tools. `call(name, args)` calls one tool with
// a fresh access token (src/background.js) and returns its result.

import { DASHBOARD_URL } from "./config.js";
import { redirectArgs } from "./rules.js";

export const URL_REGISTER = `${DASHBOARD_URL}/login`;

/** The signed-in user and the workspace the connection is for. */
export async function getAccount(call) {
  const [account, workspace] = await Promise.all([call("get-account"), call("get-workspace")]);
  return { name: account.name, email: account.email, workspace: workspace.name || null };
}

/** The link of the workspace that answers for `source` (host and path), or null. */
async function findLink(call, source) {
  const page = await call("list-links", { search: source, per_page: 50 });
  return (page.data || []).find((link) => link.url === source) || null;
}

/**
 * Saves one redirect per rule: a source the workspace already redirects (say, one hop of the
 * chain is a RedirHub link) is updated, any other is created. A failure does not stop the others.
 */
export async function saveRedirects(call, rules, note) {
  const results = [];
  for (const rule of rules) {
    const { url, destination, type } = redirectArgs(rule, note);
    try {
      const existing = await findLink(call, url);
      if (existing) {
        await call("update-link", { id: existing.id, destination, type, note });
        results.push({ rule, ok: true, id: existing.id, updated: true });
      } else {
        const created = await call("create-redirect", { url, destination, type, note });
        results.push({ rule, ok: true, id: created.id, updated: false });
      }
    } catch (error) {
      results.push({ rule, ok: false, error: error.message });
    }
  }
  return results;
}
