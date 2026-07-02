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

// server.ts resolves BRAND_DIR as "../../../docs/assets/brand" relative to
// its own file, which only lands on the real docs/assets/brand when running
// from source (tsx). The compiled dist/apps/api/src/server.js is the same
// relative depth from dist/, not from the repo root, so /static/brand/*
// 404s in production unless the folder is mirrored into dist at that same
// depth.
const srcBrandDir = path.join(root, "docs/assets/brand");
const distBrandDir = path.join(root, "dist/docs/assets/brand");
if (existsSync(srcBrandDir)) {
  mkdirSync(path.dirname(distBrandDir), { recursive: true });
  cpSync(srcBrandDir, distBrandDir, { recursive: true });
  console.log("[copy-api-assets] docs/assets/brand -> dist");
}
