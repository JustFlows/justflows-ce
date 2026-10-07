#!/usr/bin/env node
/**
 * A lockfile generated on one OS can name sharp's other platform packages
 * without resolving them. Pin the omitted ones as optional dependencies and
 * regenerate the lockfile so `npm install` on the server actually fetches
 * the binary.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { omittedSharpLockPackages } from "./sharp-native.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = path.join(ROOT, "package-lock.json");
const PKG = path.join(ROOT, "package.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function omitted() {
  if (!fs.existsSync(LOCK)) return [];
  return omittedSharpLockPackages(readJson(LOCK).packages ?? {});
}

function main() {
  const missing = omitted();
  if (missing.length === 0) return;

  const pkg = readJson(PKG);
  pkg.optionalDependencies = { ...(pkg.optionalDependencies ?? {}) };
  for (const item of missing) pkg.optionalDependencies[item.name] = item.version;
  fs.writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`);

  const npm = path.join(path.dirname(process.execPath), process.platform === "win32" ? "npm.cmd" : "npm");
  const result = spawnSync(
    fs.existsSync(npm) ? npm : "npm",
    [
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--prefer-offline",
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 5 * 60 * 1000 },
  );
  if (result.status !== 0) {
    console.error((result.stderr || result.stdout || "Could not lock sharp platform packages").trim());
    process.exit(result.status || 1);
  }
  const still = omitted();
  if (still.length > 0) {
    console.error(`package-lock.json is still missing ${still.map((item) => item.name).join(", ")}`);
    process.exit(1);
  }
  console.log(`[lock-sharp-platforms] Locked ${missing.length} sharp platform packages.`);
}

main();
