#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * Copy local uploads into the S3 bucket — command-line entry point.
 *
 *   node scripts/storage-sync.js [--dry-run] [--overwrite]
 *
 * Run once before (or right after) switching STORAGE_DRIVER=s3, so media
 * uploaded to the local `uploads/` folder keeps working. Keys keep the same
 * per-site layout (`<siteId>/...`), files already in the bucket are skipped
 * unless --overwrite, and local files are never deleted.
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

const distEntry = join(ROOT, "apps/server/dist/lib/media/upload-sync.js");
if (!existsSync(distEntry)) {
  console.error(
    "Compiled server not found. Build it first:\n" +
      "  pnpm --filter @justflows/server build:server",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const mod = await import(pathToFileURL(distEntry).href);

try {
  const result = await mod.copyLocalUploadsToStore({
    dryRun: args.includes("--dry-run"),
    overwrite: args.includes("--overwrite"),
    log: (line) => console.log(line),
  });
  console.log(
    `${args.includes("--dry-run") ? "Would copy" : "Copied"} ${result.copied}, ` +
      `skipped ${result.skipped} already in the bucket, ${result.failed.length} failed.`,
  );
  for (const line of result.failed) console.error(`  ✗ ${line}`);
  process.exit(result.failed.length > 0 ? 1 : 0);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
