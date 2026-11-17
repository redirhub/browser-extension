// A copy of the extension with its addresses (src/lib/config.js) pointed elsewhere, for e2e runs.
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

/** @param {{ MCP_URL: string, DASHBOARD_URL: string, URL_CONNECTIONS: string }} config */
export function buildExtension(config) {
  const dir = mkdtempSync(join(tmpdir(), "rh-ext-"));
  for (const entry of ["manifest.json", "src", "icons"]) cpSync(join(root, entry), join(dir, entry), { recursive: true });
  writeFileSync(join(dir, "src/lib/config.js"), Object.entries(config).map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};\n`).join(""));
  return dir;
}
