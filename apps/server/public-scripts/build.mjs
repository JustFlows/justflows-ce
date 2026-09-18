// SPDX-License-Identifier: MIT

import { build, context } from "esbuild";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Compiles apps/server/public-scripts/src/*.ts into standalone IIFE bundles
 * at public/js/*.js (repo root) — the same stable, unversioned, non-content-
 * hashed URLs the hand-written files used before this migration. Each script
 * is fully independent (no shared code between them), which is exactly
 * esbuild's native multi-entry-point use case; Vite's lib mode explicitly
 * does not support multiple entries in `iife` format.
 *
 * Minified in production (`NODE_ENV=production`, matching the near-universal
 * build-tool convention), with a linked sourcemap alongside each file so a
 * production error's stack trace still resolves to real source lines instead
 * of minified positions — server.ts's static middleware serves `*.map` with
 * the same `no-cache` policy as the scripts themselves, so a map can never go
 * stale behind a long-lived cache either. A `--watch` run is always
 * unminified regardless of NODE_ENV: it exists for active local iteration,
 * where readable output matters more than transfer size.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, "src");
const outdir = path.join(here, "../../../public/js");
const watch = process.argv.includes("--watch");
const minify = !watch && process.env.NODE_ENV === "production";

const entryPoints = readdirSync(srcDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => path.join(srcDir, name));

// esbuild's outdir mode overwrites known outputs but never deletes a file it
// isn't currently producing — an unminified run after a minified one would
// otherwise leave that run's orphaned *.js.map files behind. Clear only the
// files this script owns (by basename) rather than the whole directory,
// since nothing else is expected to live in public/js.
for (const entryPath of entryPoints) {
  const base = path.basename(entryPath, ".ts");
  rmSync(path.join(outdir, `${base}.js`), { force: true });
  rmSync(path.join(outdir, `${base}.js.map`), { force: true });
}

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
  await build(options);
}
