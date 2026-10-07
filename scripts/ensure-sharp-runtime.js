#!/usr/bin/env node
/**
 * Install sharp's native binary for this machine when the lockfile left it out.
 * Run after `npm install` during setup and during a core update, before restart.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { missingSharpPackages, sharpRuntimeId } from "./sharp-native.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function isMuslLinux() {
  if (process.platform !== "linux") return false;
  try {
    const glibc = process.report?.getReport?.()?.header?.glibcVersionRuntime;
    if (typeof glibc === "string" && glibc.length > 0) return false;
  } catch {
    /* report is best-effort */
  }
  const ldd = spawnSync("ldd", ["--version"], { encoding: "utf8" });
  return /musl/i.test(`${ldd.stdout ?? ""}\n${ldd.stderr ?? ""}`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function installedVersion(root, name) {
  const pkg = readJson(path.join(root, "node_modules", ...name.split("/"), "package.json"));
  return typeof pkg?.version === "string" ? pkg.version : null;
}

function npmBin() {
  const name = process.platform === "win32" ? "npm.cmd" : "npm";
  const candidate = path.join(path.dirname(process.execPath), name);
  return fs.existsSync(candidate) ? candidate : "npm";
}

function main() {
  const sharpPkg = readJson(path.join(ROOT, "node_modules", "sharp", "package.json"));
  if (!sharpPkg) return;
  const runtimeId = sharpRuntimeId(process.platform, process.arch, isMuslLinux());
  const installed = {};
  const names = missingSharpPackages(sharpPkg.optionalDependencies ?? {}, runtimeId, {});
  for (const item of names) installed[item.name] = installedVersion(ROOT, item.name);
  const missing = missingSharpPackages(sharpPkg.optionalDependencies ?? {}, runtimeId, installed);
  if (missing.length === 0) return;

  const result = spawnSync(
    npmBin(),
    ["install", "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", ...missing.map((item) => item.spec)],
    { cwd: ROOT, encoding: "utf8", timeout: 5 * 60 * 1000 },
  );
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n").trim();
    console.error(output || "Could not install the sharp binary for this system");
    process.exit(result.status || 1);
  }
  console.log(`Installed sharp ${runtimeId}`);
}

main();
