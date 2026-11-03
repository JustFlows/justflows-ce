// SPDX-License-Identifier: MIT

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/**
 * Prints what a first visit downloads, gzipped, after `pnpm build`:
 *
 * - the admin UI's initial set (the entry script, every `modulepreload`, and
 *   the stylesheets `index.html` links), and every admin chunk;
 * - the core scripts a public page loads with no interactive markup, and with
 *   all of it (see `PAGE_SCRIPTS` in apps/server/src/lib/rendering/page-scripts.ts).
 *
 * With `--check` it exits non-zero when a total is over its budget. Raise a
 * budget only on purpose, in the same change that needs it.
 */

/** About 10% over the sizes when the budgets were set (154, 12, 1.0, and 7.8 KB). */
const BUDGETS_KB = {
  adminInitialJs: 170,
  adminInitialCss: 14,
  publicPlainPageJs: 1.5,
  publicInteractivePageJs: 9,
};

/** Core layout scripts: always, and the full set a page with every kind of markup loads. */
const PUBLIC_PLAIN = ["site-chrome"];
const PUBLIC_INTERACTIVE = ["site-chrome", "site-nav", "site-toast", "site-session", "block-animations", "block-interactions"];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adminDir = path.join(root, "apps/server/admin-ui/dist/client");
const publicJsDir = path.join(root, "public/js");
const check = process.argv.includes("--check");

const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function fail(message) {
  console.error(`[asset-budgets] ${message}`);
  process.exit(1);
}

if (!existsSync(path.join(adminDir, "index.html"))) fail("admin UI is not built; run `pnpm build` first");
if (!existsSync(path.join(publicJsDir, "manifest.json"))) fail("public scripts are not built; run `pnpm build` first");

const html = readFileSync(path.join(adminDir, "index.html"), "utf8");
const refs = (re) => [...html.matchAll(re)].map((match) => match[1]);
const initialJs = [...new Set([
  ...refs(/<script[^>]+type="module"[^>]+src="\/([^"]+)"/g),
  ...refs(/<link[^>]+rel="modulepreload"[^>]+href="\/([^"]+)"/g),
])];
const initialCss = refs(/<link[^>]+rel="stylesheet"[^>]+href="\/([^"]+)"/g);

const sum = (files, dir) => files.reduce((total, file) => total + gz(path.join(dir, file)), 0);
const totals = {
  adminInitialJs: sum(initialJs, adminDir),
  adminInitialCss: sum(initialCss, adminDir),
};

console.log(`Admin initial load: ${initialJs.length} scripts ${kb(totals.adminInitialJs)}, ${initialCss.length} stylesheets ${kb(totals.adminInitialCss)} (gzip)`);
for (const file of [...initialJs, ...initialCss]) console.log(`  ${file.padEnd(48)} ${kb(gz(path.join(adminDir, file)))}`);

const assets = readdirSync(path.join(adminDir, "assets")).filter((file) => /\.(?:js|css)$/.test(file));
const lazy = assets
  .map((file) => `assets/${file}`)
  .filter((file) => !initialJs.includes(file) && !initialCss.includes(file))
  .map((file) => ({ file, size: gz(path.join(adminDir, file)) }))
  .sort((a, b) => b.size - a.size);
console.log(`Admin on demand: ${lazy.length} files ${kb(lazy.reduce((total, item) => total + item.size, 0))} (largest 10)`);
for (const item of lazy.slice(0, 10)) console.log(`  ${item.file.padEnd(48)} ${kb(item.size)}`);

const manifest = JSON.parse(readFileSync(path.join(publicJsDir, "manifest.json"), "utf8"));
const publicSum = (names) =>
  names.reduce((total, name) => {
    if (!manifest[name]) fail(`public/js/manifest.json has no ${name}`);
    return total + gz(path.join(root, "public", manifest[name]));
  }, 0);
totals.publicPlainPageJs = publicSum(PUBLIC_PLAIN);
totals.publicInteractivePageJs = publicSum(PUBLIC_INTERACTIVE);
console.log(`Public page core scripts: plain ${PUBLIC_PLAIN.length} ${kb(totals.publicPlainPageJs)}, interactive ${PUBLIC_INTERACTIVE.length} ${kb(totals.publicInteractivePageJs)} (gzip)`);

const over = Object.entries(BUDGETS_KB).filter(([key, budget]) => totals[key] > budget * 1024);
for (const [key, budget] of over) console.error(`[asset-budgets] ${key} is ${kb(totals[key])}, over its ${budget} KB budget`);
if (check && over.length) process.exit(1);
if (check) console.log("[asset-budgets] all totals within budget");
