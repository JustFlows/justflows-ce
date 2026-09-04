#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * Static / edge export — command-line entry point.
 *
 *   node scripts/export-static.js [--incremental] [--base-url http://127.0.0.1:3000]
 *
 * Crawls a *running* Justflows site over loopback and writes published pages,
 * assets, sitemap, robots and theme CSS to STATIC_EXPORT_DIR (default
 * ./static-export). Browser-first operators use Admin → System → Tools →
 * "Static site export" instead; this script is for CI and cron.
 *
 * Requires a compiled server (`pnpm --filter @justflows/server build:server`).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Match root server.js: load .env without overriding real environment.
try {
  const envPath = join(ROOT, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key && !(key in process.env)) process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
} catch {
  // no .env — rely on the ambient environment
}
process.env.JF_ROOT = process.env.JF_ROOT || ROOT;

const distEntry = join(ROOT, "apps/server/dist/lib/static-export/index.js");
if (!existsSync(distEntry)) {
  console.error(
    "Compiled server not found. Build it first:\n" +
      "  pnpm --filter @justflows/server build:server\n" +
      "or run the export from Admin → System → Tools → Static site export.",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const incremental = args.includes("--incremental");
const clear = args.includes("--clear");
const baseIdx = args.indexOf("--base-url");
const baseUrl = baseIdx !== -1 ? args[baseIdx + 1] : undefined;

const mod = await import(pathToFileURL(distEntry).href);

try {
  if (clear) {
    const result = await mod.clearStaticExport({ force: args.includes("--force") });
    console.log(
      result.removed ? `✓ Deleted ${result.outDir}` : `• ${result.reason ?? "nothing to clear"}`,
    );
    process.exit(result.ok ? 0 : 1);
  }
  const summary = await mod.runStaticExport({
    mode: incremental ? "incremental" : "full",
    baseUrl,
    reason: "cli",
    log: (line) => console.log(line),
  });
  process.exit(summary.ok ? 0 : 1);
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
