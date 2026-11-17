// Calls tools of the RedirHub MCP server over HTTP: one JSON-RPC request per call, no session.

import { MCP_URL } from "./config.js";

export class McpError extends Error {
  constructor(message, { unauthorized = false } = {}) {
    super(message);
    this.unauthorized = unauthorized;
  }
}

/** The value of a tool result: its structured content, else its text read as JSON or as is. */
export function resultOf(answer) {
  if (answer.error) throw new McpError(answer.error.message || "RedirHub refused the request.");
  const result = answer.result || {};
  const text = (result.content || []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
  if (result.isError) throw new McpError(text || "RedirHub refused the request.");
  if (result.structuredContent !== undefined) return result.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

let nextId = 1;

export async function callTool(accessToken, name, args = {}) {
  let response;
  try {
    response = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
    });
  } catch {
    throw new McpError("RedirHub could not be reached. Check your connection.");
  }
  if (response.status === 401) throw new McpError("Your RedirHub connection ended. Connect again.", { unauthorized: true });
  if (!response.ok) throw new McpError(`RedirHub answered ${response.status}`);
  const type = response.headers.get("content-type") || "";
  const body = await response.text();
  // A server may answer as an event stream: the JSON-RPC message is in its data line.
  const json = type.includes("text/event-stream") ? body.split("\n").find((line) => line.startsWith("data:"))?.slice(5) : body;
  return resultOf(JSON.parse(json));
}
