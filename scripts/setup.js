#!/usr/bin/env node
/**
 * Justflows setup script for shared hosting / cPanel.
 *
 * Run once after uploading the release:
 *   node scripts/setup.js
 *
 * What it does:
 *   1. Checks Node.js version
 *   2. Installs production dependencies (no dev tools)
 *   3. Runs database migrations
 *   4. Confirms the install wizard URL
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const ROOT = new URL("..", import.meta.url).pathname;

function run(cmd, opts = {}) {
  console.log(`  → ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit", ...opts });
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
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
    const examplePath = resolve(ROOT, ".env.production.example");
    if (existsSync(examplePath)) {
      console.log("\n⚠  No .env file found.");
      console.log("   Copy .env.production.example → .env and fill in:");
      console.log("     APP_URL    — your site's public URL");
      console.log("     APP_SECRET — a long random string (run: openssl rand -base64 48)");
      console.log("     DATABASE_URL — your database connection string\n");

      const cont = await ask("Have you created .env? (y/N): ");
      if (cont.toLowerCase() !== "y") {
        console.log("Please create .env first, then run this script again.");
        process.exit(0);
      }
    }
  } else {
    console.log("✓ .env found");
  }

  // 3. Install production dependencies
  console.log("\nInstalling dependencies (this may take a minute)…");
  try {
    run("npm install --omit=dev --ignore-scripts");
  } catch {
    // Try pnpm as fallback
    try {
      run("pnpm install --prod --frozen-lockfile");
    } catch {
      console.error("✗ Could not install dependencies. Make sure npm or pnpm is available.");
      process.exit(1);
    }
  }
  console.log("✓ Dependencies installed");

  // 4. Run migrations
  console.log("\nRunning database migrations…");
  try {
    run("node scripts/migrate.js");
    console.log("✓ Database ready");
  } catch (e) {
    console.error("✗ Migration failed:", e.message);
    console.log("  Check your DATABASE_URL in .env and make sure the database exists.");
    process.exit(1);
  }

  // 5. Done
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║        Justflows is ready! 🎉        ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(`\nOpen this URL in your browser to finish setup:\n\n  ${appUrl}/install\n`);
  console.log("The browser wizard will create your admin account and configure your site.\n");
}

main().catch(e => {
  console.error("Setup failed:", e);
  process.exit(1);
});
