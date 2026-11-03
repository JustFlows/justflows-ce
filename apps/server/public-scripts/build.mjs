// SPDX-License-Identifier: MIT

import { build, context } from "esbuild";
import { copyFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Compiles apps/server/public-scripts/src/*.ts into standalone IIFE bundles
 * in public/js (repo root). Each script is fully independent (no shared code
 * between them), which is exactly esbuild's native multi-entry-point use case;
 * Vite's lib mode explicitly does not support multiple entries in `iife`
 * format.
 *
 * A build writes each script twice: a content-hashed `<name>-<hash>.js`,
 * which pages link through `public/js/manifest.json` and the server caches as
 * `immutable`, and the stable `<name>.js` (same bytes) for anything that still
 * names the old URL. A `--watch` run writes only the stable names and removes
 * the manifest, so pages link the `no-cache` URLs while you iterate.
 *
 * Minified in production (`NODE_ENV=production`), with a linked sourcemap
 * beside each file so a production stack trace still resolves to real source
 * lines. A `--watch` run is always unminified regardless of NODE_ENV.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, "src");
const outdir = path.join(here, "../../../public/js");
const manifestPath = path.join(outdir, "manifest.json");
const watch = process.argv.includes("--watch");
const minify = !watch && process.env.NODE_ENV === "production";

const entryPoints = readdirSync(srcDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => path.join(srcDir, name));
const names = new Set(entryPoints.map((entryPath) => path.basename(entryPath, ".ts")));

/**
 * esbuild never deletes a file it isn't currently producing, so clear the
 * files this script owns (stable and hashed, with their maps) by basename.
 * Nothing else is expected to live in public/js. Requests for a hashed name
 * that is gone are answered with the current file by the server.
 */
const owned = /^(.+?)(?:-[A-Z0-9]{8})?\.js(?:\.map)?$/;
for (const file of readdirSync(outdir, { withFileTypes: true })) {
  const match = file.isFile() ? owned.exec(file.name) : null;
  if (match && names.has(match[1])) rmSync(path.join(outdir, file.name), { force: true });
}
rmSync(manifestPath, { force: true });

const options = {
  entryPoints,
  outdir,
  bundle: true,
  format: "iife",
  target: "es2018",
  minify,
  sourcemap: minify,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(`[public-scripts] watching ${entryPoints.length} file(s) for changes...`);
} else {
  console.log(`[public-scripts] building ${minify ? "minified" : "unminified"} output...`);
  const result = await build({ ...options, entryNames: "[name]-[hash]", metafile: true });
  /** @type {Record<string, string>} */
  const manifest = {};
  for (const [outPath, meta] of Object.entries(result.metafile.outputs)) {
    if (!meta.entryPoint || !outPath.endsWith(".js")) continue;
    const name = path.basename(meta.entryPoint, ".ts");
    const hashed = path.basename(outPath);
    copyFileSync(path.resolve(outPath), path.join(outdir, `${name}.js`));
    manifest[name] = `/js/${hashed}`;
  }
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(manifestPath, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`[public-scripts] wrote manifest.json (${Object.keys(sorted).length} scripts)`);
}
