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
const { pathToFileURL } = require("url");

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
  if (process.env.STATE === "INSTALLED") return true;
  try {
    const envPath = path.join(root, ".env");
    const contents = fs.readFileSync(envPath, "utf-8");
    const installed = contents.split("\n").some((line) => line.trim() === "STATE=INSTALLED");
    if (installed) process.env.STATE = "INSTALLED";
    return installed;
  } catch {
    return false;
  }
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
  if (bootError) return Promise.reject(bootError);
  if (!bootPromise) {
    const entry = serverEntry();
    if (!entry) {
      bootError = new Error("Server not built — run: npm run install:all");
      return Promise.reject(bootError);
    }
    bootPromise = import(pathToFileURL(entry).href)
      .then(async (mod) => {
        const app = typeof mod.createFullApp === "function" ? await mod.createFullApp() : mod.createApp();
        fullApp = app;
        return app;
      })
      .catch((err) => {
        bootError = err;
        console.error("[justflows] Boot failed:", err);
        throw err;
      });
  }
  return bootPromise;
}

function needsFullApp(pathname) {
  if (pathname === "/api/healthz") return false;
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

  if (pathname === "/" && !isInstalled()) {
    res.writeHead(302, { Location: "/install" });
    res.end();
    return;
  }

  if ((pathname === "/install" || pathname === "/login") && fs.existsSync(adminIndex)) {
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

  if (fullApp) {
    dispatch(fullApp, req, res);
    return;
  }

  if (bootError) {
    sendJson(res, 503, { ok: false, error: "boot_failed", message: String(bootError.message || bootError) });
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
    console.log(`> Install: http://${host}:${port}/install`);
  });
}
