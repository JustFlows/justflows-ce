#!/usr/bin/env node
/**
 * Justflows setup for two audiences:
 *
 *   Advanced / git checkout:  pnpm install (full workspace, including tools)
 *   Shared hosting zip:       npm production install
 *
 * Browser first-run (index.html) is the no-terminal path. This script is the
 * command-line equivalent.
 */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const gate = require("./bootstrap-gate.cjs");

function run(cmd, opts = {}) {
  console.log(`  → ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit", ...opts });
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolveAsk => rl.question(question, ans => { rl.close(); resolveAsk(ans.trim()); }));
}

function readRootPackage() {
  return JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
}

function hasWorkspaceProtocol(pkg = readRootPackage()) {
  if (pkg.workspaces) return true;
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const spec of Object.values(pkg[field] ?? {})) {
      if (typeof spec === "string" && spec.startsWith("workspace:")) return true;
    }
  }
  return false;
}

function stashPnpmNodeModules() {
  const pnpmStore = resolve(ROOT, "node_modules/.pnpm");
  if (!existsSync(pnpmStore)) return null;
  const hidden = resolve(ROOT, "node_modules.pnpm-hidden");
  rmSync(hidden, { recursive: true, force: true });
  renameSync(resolve(ROOT, "node_modules"), hidden);
  return hidden;
}

function restorePnpmNodeModules(hidden) {
  if (!hidden || !existsSync(hidden)) return;
  rmSync(resolve(ROOT, "node_modules"), { recursive: true, force: true });
  renameSync(hidden, resolve(ROOT, "node_modules"));
}

function npmInstallProduction() {
  const hidden = stashPnpmNodeModules();
  try {
    run("npm install --omit=dev --ignore-scripts");
  } catch (err) {
    restorePnpmNodeModules(hidden);
    throw err;
  }
  if (hidden) rmSync(hidden, { recursive: true, force: true });
}

function isDeveloperCheckout() {
  return gate.isGitCheckout(ROOT) || (
    hasWorkspaceProtocol() && existsSync(resolve(ROOT, "pnpm-lock.yaml"))
  );
}

function installDeps() {
  if (isDeveloperCheckout()) {
    // Keep the full toolchain. --prod would delete typescript, vitest, turbo.
    run("pnpm install", { env: { ...process.env, CI: process.env.CI || "1" } });
    return;
  }

  if (hasWorkspaceProtocol()) {
    run("node scripts/prepare-hosting.js");
  }
  npmInstallProduction();
}

function runMigrations() {
  const migrate = resolve(ROOT, "scripts/migrate.js");
  if (!existsSync(migrate)) {
    console.log("  (skipped — the browser wizard creates tables on first install)");
    return;
  }
  run("node scripts/migrate.js");
}

async function main() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║       Justflows Setup Wizard         ║");
  console.log("╚══════════════════════════════════════╝\n");

  // 1. Node.js version check
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 22) {
    console.error(`✗ Node.js 22 or higher is required. You have ${process.version}.`);
    process.exit(1);
  }
  console.log(`✓ Node.js ${process.version}`);

  // 2. Check for .env
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) {
    const exampleName = isDeveloperCheckout() && existsSync(resolve(ROOT, ".env.example"))
      ? ".env.example"
      : ".env.production.example";
    const examplePath = resolve(ROOT, exampleName);
    if (existsSync(examplePath)) {
      console.log("\n⚠  No .env file found.");
      console.log(`   Copy ${exampleName} → .env and fill in:`);
      console.log("     APP_URL    — your site's public URL");
      console.log("     APP_SECRET — a long random string (run: openssl rand -base64 48)");
      console.log("     DB_DRIVER, DB_HOST, DB_NAME, DB_USER, DB_PASSWORD\n");

      const cont = await ask("Have you created .env? (y/N): ");
      if (cont.toLowerCase() !== "y") {
        console.log("Please create .env first, then run this script again.");
        process.exit(0);
      }
    }
  } else {
    console.log("✓ .env found");
  }

  // 3. Install dependencies
  console.log("\nInstalling dependencies (this may take a minute)…");
  try {
    installDeps();
  } catch {
    console.error("✗ Could not install dependencies. Make sure npm or pnpm is available.");
    process.exit(1);
  }
  console.log("✓ Dependencies installed");

  // 4. Run migrations when a dedicated script is present (zip/hosting).
  // Git checkouts do not ship scripts/migrate.js — /install applies schema.
  console.log("\nRunning database migrations…");
  try {
    runMigrations();
    console.log("✓ Database step complete");
  } catch (e) {
    console.error("✗ Migration failed:", e.message);
    console.log("  Check DB_HOST / DB_NAME in .env and make sure the database exists.");
    process.exit(1);
  }

  // 5. Done
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║        Justflows is ready! 🎉        ║");
  console.log("╚══════════════════════════════════════╝");
  if (isDeveloperCheckout()) {
    console.log(`\nNext:\n  pnpm --filter @justflows/server dev`);
    console.log(`  then open ${appUrl}/install\n`);
  } else {
    console.log(`\nOpen this URL in your browser to finish setup:\n\n  ${appUrl}\n`);
  }
  console.log("The browser wizard will create your admin account and configure your site.\n");
}

main().catch(e => {
  console.error("Setup failed:", e);
  process.exit(1);
});
