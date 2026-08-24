// SPDX-License-Identifier: MIT
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function isInstalled(root, env = process.env) {
  if (env.STATE === "INSTALLED") return true;
  try {
    const contents = fs.readFileSync(path.join(root, ".env"), "utf8");
    const installed = contents.split("\n").some((line) => line.trim() === "STATE=INSTALLED");
    if (installed) env.STATE = "INSTALLED";
    return installed;
  } catch {
    return false;
  }
}

function isGitCheckout(root) {
  return fs.existsSync(path.join(root, ".git"));
}

function indexHtmlPath(root) {
  return path.join(root, "index.html");
}

function bootstrapPageEnabled(root, env = process.env) {
  return !isInstalled(root, env) && fs.existsSync(indexHtmlPath(root));
}

function bootstrapSpawnAllowed(root, env = process.env) {
  return bootstrapPageEnabled(root, env) && !isGitCheckout(root);
}

function depsReady(root) {
  const express = path.join(root, "node_modules", "express");
  const core = path.join(root, "node_modules", "@justflows", "core");
  const admin = path.join(root, "apps/server/admin-ui/dist/index.html");
  const bundle = path.join(root, "apps/server/dist/server.bundle.mjs");
  const plain = path.join(root, "apps/server/dist/server.js");
  const hasServer = fs.existsSync(bundle) || fs.existsSync(plain);
  // The production bundle inlines @justflows/*; unbundled dist still needs the
  // workspace package on disk.
  const hasWorkspace = fs.existsSync(core) || fs.existsSync(bundle);
  return fs.existsSync(express) && fs.existsSync(admin) && hasServer && hasWorkspace;
}

function statusFile(root) {
  return path.join(root, "tmp", "bootstrap-status.json");
}

function logFile(root) {
  return path.join(root, "tmp", "bootstrap.log");
}

function readStatus(root) {
  try {
    return JSON.parse(fs.readFileSync(statusFile(root), "utf8"));
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function jobStatus(root) {
  const job = readStatus(root);
  if (!job) return { status: "idle" };
  if (job.status === "running" && !job.pid) {
    const started = Date.parse(job.startedAt || "");
    if (Number.isFinite(started) && Date.now() - started > 30_000) {
      return { ...job, status: "error", error: "Setup did not start. You can try again." };
    }
  }
  if (job.status === "running" && job.pid && !pidAlive(job.pid)) {
    return { ...job, status: "error", error: "Setup was interrupted. You can try again." };
  }
  return job;
}

function readLogTail(root, maxBytes = 64 * 1024) {
  const file = logFile(root);
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

function writeStatus(root, patch) {
  const dir = path.join(root, "tmp");
  fs.mkdirSync(dir, { recursive: true });
  const current = readStatus(root) ?? {};
  fs.writeFileSync(statusFile(root), `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`);
}

function removeBootstrapIndex(root, env = process.env) {
  if (isGitCheckout(root)) return false;
  if (!isInstalled(root, env) && env.JF_FORCE_REMOVE_BOOTSTRAP !== "1") {
    // Keep the first-run page until the site is actually installed,
    // unless an explicit force flag is set (used by tests).
    return false;
  }
  const target = indexHtmlPath(root);
  try {
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      return true;
    }
  } catch (err) {
    console.warn("[justflows] Could not remove bootstrap index.html:", err);
  }
  return false;
}

module.exports = {
  isInstalled,
  isGitCheckout,
  indexHtmlPath,
  bootstrapPageEnabled,
  bootstrapSpawnAllowed,
  depsReady,
  jobStatus,
  readLogTail,
  writeStatus,
  removeBootstrapIndex,
  statusFile,
  logFile,
};
