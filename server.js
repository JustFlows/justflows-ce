#!/usr/bin/env node
/**
 * Justflows entry point — Plesk, cPanel, VPS, Docker, local.
 *
 * Application startup file: server.js
 * Or run: npm start
 */
"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const gate = require("./scripts/bootstrap-gate.cjs");
const installToken = require("./scripts/install-token.cjs");

const root = __dirname;
process.env.JF_ROOT = process.env.JF_ROOT || root;
process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.JF_EAGER_BOOT = "1";

function loadDotEnv() {
  try {
    const envPath = path.join(root, ".env");
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch {
    // no .env yet
  }
}

loadDotEnv();

function isInstalled() {
  return gate.isInstalled(root);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function startBootstrap() {
  const job = gate.jobStatus(root);
  if (job.status === "running") return { started: false, reason: "already_running" };
  gate.writeStatus(root, {
    status: "running",
    pid: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    error: null,
  });
  const child = spawn(process.execPath, [path.join(root, "scripts/bootstrap-install.js")], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "production" },
  });
  child.on("error", (err) => {
    gate.writeStatus(root, {
      status: "error",
      finishedAt: new Date().toISOString(),
      error: String(err.message || err),
    });
  });
  child.unref();
  return { started: true };
}

if (isInstalled()) {
  gate.removeBootstrapIndex(root);
} else if (installToken.installTokenRequired()) {
  // Mint before the wizard so File Manager shows install-token/TOKEN.txt
  // without waiting for the Express app to boot.
  installToken.ensureInstallToken(root);
}

const adminDist = path.join(root, "apps/server/admin-ui/dist");
const adminIndex = path.join(adminDist, "index.html");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function safePath(base, rel) {
  const resolved = path.resolve(base, rel);
  if (!resolved.startsWith(path.resolve(base))) return null;
  return resolved;
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Powered-By": "Justflows",
    });
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "X-Powered-By": "Justflows",
  });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "X-Powered-By": "Justflows",
  });
  res.end(JSON.stringify(body));
}

function serverEntry() {
  const bundle = path.join(root, "apps/server/dist/server.bundle.mjs");
  const plain = path.join(root, "apps/server/dist/server.js");
  if (fs.existsSync(bundle)) return bundle;
  if (fs.existsSync(plain)) return plain;
  return null;
}

let fullApp = null;
let bootPromise = null;
let bootError = null;

function bootFullApp() {
  if (fullApp) return Promise.resolve(fullApp);
  if (bootPromise) return bootPromise;
  const entry = serverEntry();
  if (!entry) {
    bootError = new Error("Server not built — open this site in a browser to finish setup");
    return Promise.reject(bootError);
  }
  const href = pathToFileURL(entry).href;
  // Node caches a failed ESM evaluation; bust it after npm install finishes.
  const url = bootError ? `${href}?retry=${Date.now()}` : href;
  bootError = null;
  bootPromise = import(url)
    .then(async (mod) => {
      const app = typeof mod.createFullApp === "function" ? await mod.createFullApp() : mod.createApp();
      fullApp = app;
      return app;
    })
    .catch((err) => {
      bootError = err;
      bootPromise = null;
      console.error("[justflows] Boot failed:", err);
      throw err;
    });
  return bootPromise;
}

function needsFullApp(pathname) {
  if (pathname === "/api/healthz") return false;
  if (pathname === "/api/bootstrap" || pathname === "/api/bootstrap/status") return false;
  if (pathname === "/install" || pathname === "/login") return false;
  if (pathname === "/") return isInstalled();
  if (pathname.startsWith("/assets/")) return false;
  return true;
}

function dispatch(app, req, res) {
  app.handle(req, res, () => {
    res.statusCode = 404;
    res.end("Not found");
  });
}

const server = http.createServer((req, res) => {
  const pathname = (req.url ?? "/").split("?")[0];

  if (pathname === "/api/healthz") {
    sendJson(res, 200, {
      ok: true,
      boot: fullApp ? "ready" : bootError ? "error" : "starting",
      entry: serverEntry() ? path.basename(serverEntry()) : "missing",
    });
    return;
  }

  if (pathname === "/api/bootstrap/status") {
    sendJson(res, 200, {
      installed: isInstalled(),
      gitCheckout: gate.isGitCheckout(root),
      allowed: gate.bootstrapSpawnAllowed(root),
      ready: gate.depsReady(root),
      job: gate.jobStatus(root),
      log: gate.readLogTail(root),
    });
    return;
  }

  if (pathname === "/api/bootstrap" && req.method === "POST") {
    if (!sameOrigin(req)) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }
    if (isInstalled()) {
      sendJson(res, 409, { error: "Already installed" });
      return;
    }
    if (gate.depsReady(root)) {
      sendJson(res, 200, { ok: true, ready: true });
      return;
    }
    if (!gate.bootstrapSpawnAllowed(root)) {
      sendJson(res, 403, { error: "Browser setup is only available on an unzipped release, before the site is installed." });
      return;
    }
    const result = startBootstrap();
    if (!result.started) {
      sendJson(res, 409, { error: "Setup is already running", reason: result.reason });
      return;
    }
    sendJson(res, 202, { ok: true, started: true });
    return;
  }

  if (pathname === "/" && !isInstalled()) {
    if (gate.bootstrapPageEnabled(root) && !gate.isGitCheckout(root)) {
      sendFile(res, gate.indexHtmlPath(root));
      return;
    }
    res.writeHead(302, { Location: "/install" });
    res.end();
    return;
  }

  if ((pathname === "/install" || pathname === "/login") && fs.existsSync(adminIndex)) {
    if (
      pathname === "/install" &&
      !isInstalled() &&
      !gate.depsReady(root) &&
      gate.bootstrapPageEnabled(root)
    ) {
      res.writeHead(302, { Location: "/" });
      res.end();
      return;
    }
    sendFile(res, adminIndex);
    return;
  }

  if (pathname.startsWith("/assets/")) {
    const file = safePath(adminDist, pathname.slice(1));
    if (file) {
      sendFile(res, file);
      return;
    }
  }

  if (!needsFullApp(pathname)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  if (!fullApp && !gate.depsReady(root)) {
    sendJson(res, 503, {
      ok: false,
      error: "not_ready",
      message:
        "Justflows is still installing dependencies. Wait for the first-run setup to finish, then try again.",
    });
    return;
  }

  if (fullApp) {
    dispatch(fullApp, req, res);
    return;
  }

  bootFullApp()
    .then((app) => dispatch(app, req, res))
    .catch((err) => {
      if (!res.headersSent) {
        sendJson(res, 503, {
          ok: false,
          error: "boot_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
});

module.exports = server;

// Phusion Passenger (Plesk/cPanel) — must call listen() before routing requests.
if (typeof PhusionPassenger !== "undefined") {
  server.listen("passenger");
} else if (require.main === module) {
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.HOSTNAME ?? "0.0.0.0";
  server.listen(port, host, () => {
    console.log(`> Justflows ready on http://${host}:${port}`);
    console.log(`> Open that URL in a browser to install`);
  });
}
