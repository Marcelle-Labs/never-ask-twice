import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const srcUiDir = path.join(root, "apps/api/src/ui");
const distUiDir = path.join(root, "dist/apps/api/src/ui");

const assets = ["landing.html", "index.css", "fonts"];

mkdirSync(distUiDir, { recursive: true });

for (const asset of assets) {
  const from = path.join(srcUiDir, asset);
  const to = path.join(distUiDir, asset);
  if (!existsSync(from)) continue;
  cpSync(from, to, { recursive: true });
  console.log(`[copy-api-assets] ${asset} -> dist`);
}
