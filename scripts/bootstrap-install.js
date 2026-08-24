#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * Detached runner for the browser first-run installer.
 * Writes tmp/bootstrap-status.json and tmp/bootstrap.log. No user input.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const gate = require("./bootstrap-gate.cjs");

if (!gate.bootstrapSpawnAllowed(ROOT)) {
  console.error("Browser setup is not allowed in this tree.");
  process.exit(1);
}

const logPath = gate.logFile(ROOT);
fs.mkdirSync(path.dirname(logPath), { recursive: true });
fs.writeFileSync(logPath, "");
gate.writeStatus(ROOT, {
  status: "running",
  pid: process.pid,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  exitCode: null,
  error: null,
});

const child = spawn(process.execPath, [path.join(ROOT, "scripts/install-all.js")], {
  cwd: ROOT,
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "production" },
  stdio: ["ignore", "pipe", "pipe"],
});

const out = fs.createWriteStream(logPath, { flags: "a" });
child.stdout.pipe(out);
child.stderr.pipe(out);

child.on("error", (err) => {
  gate.writeStatus(ROOT, {
    status: "error",
    finishedAt: new Date().toISOString(),
    error: String(err.message || err),
  });
  out.end();
  process.exit(1);
});

child.on("exit", (code, signal) => {
  gate.writeStatus(ROOT, {
    status: code === 0 ? "ok" : "error",
    exitCode: code,
    signal: signal ?? null,
    finishedAt: new Date().toISOString(),
    error: code === 0 ? null : `Setup exited with code ${code ?? signal}`,
  });
  out.end();
  process.exit(code === 0 ? 0 : 1);
});
