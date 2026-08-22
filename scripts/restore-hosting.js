#!/usr/bin/env node
/** Restore package.json files after prepare-hosting.js (local dev only). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKUP_DIR = path.join(ROOT, ".hosting-backup");

if (!fs.existsSync(BACKUP_DIR)) {
  process.exit(0);
}

const PACKAGE_DIRS = [
  "apps/server",
  "packages/blocks",
  "packages/installer",
  "packages/core",
  "packages/cache",
  "packages/auth",
  "packages/sdk",
  "packages/database",
  "packages/plugin-api",
  "packages/content",
];

for (const dir of PACKAGE_DIRS) {
  const backup = path.join(BACKUP_DIR, dir.replace(/\//g, "__") + ".json");
  const pkgPath = path.join(ROOT, dir, "package.json");
  if (fs.existsSync(backup)) {
    fs.copyFileSync(backup, pkgPath);
  }
}

const rootBackup = path.join(BACKUP_DIR, "root.json");
if (fs.existsSync(rootBackup)) {
  fs.copyFileSync(rootBackup, path.join(ROOT, "package.json"));
}

fs.rmSync(BACKUP_DIR, { recursive: true });
console.log("[restore-hosting] Restored package.json files.");
