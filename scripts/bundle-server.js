#!/usr/bin/env node
/**
 * Bundle apps/server/dist into one file for faster cold boot on shared hosting.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "apps/server/dist/server.js");
const outfile = path.join(root, "apps/server/dist/server.bundle.mjs");

if (!fs.existsSync(entry)) {
  console.error("[bundle-server] Missing apps/server/dist/server.js — run build:server first.");
  process.exit(1);
}

const result = spawnSync(
  "npx",
  [
    "esbuild",
    entry,
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--packages=external",
    `--outfile=${outfile}`,
  ],
  { cwd: root, stdio: "inherit" },
);

if (result.status !== 0) process.exit(result.status ?? 1);
console.log("[bundle-server] Wrote", path.relative(root, outfile));
