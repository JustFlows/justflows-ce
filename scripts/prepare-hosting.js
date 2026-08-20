#!/usr/bin/env node
/**
 * Patch workspace:* deps to file: paths so `npm install` works on Plesk/cPanel.
 * Run before `npm install` in make-zip.sh; restore with restore-hosting.js after.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKUP_DIR = path.join(ROOT, ".hosting-backup");

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
];

function findPackageJson(name) {
  for (const dir of PACKAGE_DIRS) {
    const pkgPath = path.join(ROOT, dir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    if (pkg.name === name) return pkgPath;
  }
  return null;
}

function patchFile(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  let changed = false;

  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const deps = pkg[field];
    if (!deps) continue;

    for (const [name, version] of Object.entries(deps)) {
      if (version !== "workspace:*") continue;

      const target = findPackageJson(name);
      if (!target) {
        console.warn(`[prepare-hosting] Unknown workspace package: ${name} in ${pkgPath}`);
        continue;
      }

      let rel = path.relative(path.dirname(pkgPath), path.dirname(target));
      if (!rel.startsWith(".")) rel = `./${rel}`;
      deps[name] = `file:${rel.replace(/\\/g, "/")}`;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

function main() {
  if (fs.existsSync(BACKUP_DIR)) {
    fs.rmSync(BACKUP_DIR, { recursive: true });
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  for (const dir of PACKAGE_DIRS) {
    const pkgPath = path.join(ROOT, dir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;

    const backup = path.join(BACKUP_DIR, dir.replace(/\//g, "__") + ".json");
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(pkgPath, backup);
    patchFile(pkgPath);
  }

  // Root: add production deps npm can install (hoisted for apps/server).
  const rootPkgPath = path.join(ROOT, "package.json");
  fs.copyFileSync(rootPkgPath, path.join(BACKUP_DIR, "root.json"));

  const root = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
  root.dependencies = {
    express: "^5.1.0",
    compression: "^1.8.1",
    "cookie-parser": "^1.4.7",
    ejs: "^3.1.10",
    multer: "^2.0.2",
    mysql2: "^3.15.2",
    nodemailer: "^7.0.11",
    postgres: "^3.4.9",
    zod: "^3.25.76",
    "@justflows/blocks": "file:packages/blocks",
    "@justflows/cache": "file:packages/cache",
    "@justflows/core": "file:packages/core",
    "@justflows/installer": "file:packages/installer",
    "@justflows/plugin-api": "file:packages/plugin-api",
    "@justflows/sdk": "file:packages/sdk",
  };
  root.scripts = root.scripts ?? {};
  root.scripts["build:server"] = "node scripts/install-all.js --build-only";
  delete root.workspaces;
  fs.writeFileSync(rootPkgPath, `${JSON.stringify(root, null, 2)}\n`);

  console.log("[prepare-hosting] Patched package.json files for npm hosting.");
}

main();
