// Builds the ZIP the Chrome Web Store takes: manifest, code and icons only.
//   npm run pack   ->  dist/redirhub-extension-<version>.zip
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const zip = join(root, "dist", `redirhub-extension-${version}.zip`);
rmSync(zip, { force: true });
mkdirSync(join(root, "dist"), { recursive: true });
execFileSync("zip", ["-qr", "-X", zip, "manifest.json", "src", "icons"], { cwd: root, stdio: "inherit" });
console.log(zip);
