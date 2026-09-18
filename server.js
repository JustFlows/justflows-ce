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
const fsp = require("fs/promises");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const gate = require("./scripts/bootstrap-gate.cjs");
const installToken = require("./scripts/install-token.cjs");
const { withSecurityHeaders, ADMIN_CSP } = require("./scripts/security-headers.cjs");
const { randomBytes } = require("crypto");

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

/**
 * Reject a cross-origin browser request.
 *
 * A missing Origin used to return true, which meant any non-browser client —
 * `curl -X POST /api/bootstrap` — sailed past. It is now only a secondary
 * check: the install token below is what actually authorises the request, and
 * this stops a page on another site from driving it in a logged-in browser.
 */
function crossOriginRequest(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

/**
 * Best-effort real client address, mirroring the full app's `trust proxy`
 * default (`apps/server/src/server.ts`: "loopback" unless TRUST_PROXY says
 * otherwise).
 *
 * Without this, a site deployed behind a same-host reverse proxy (nginx,
 * Passenger, a Docker proxy — the normal Plesk/cPanel setup this file targets)
 * sees every request as coming from the proxy's own loopback address, which
 * would make `bootstrapAuthorised` below treat every remote visitor as a
 * trusted local operator during the pre-install window. X-Forwarded-For is
 * only consulted when the *direct* TCP peer is already loopback: a remote
 * attacker cannot forge that peer address (TCP requires completing the
 * handshake from wherever they really are), so the only way to reach this
 * branch is a genuine local process or a reverse proxy the operator runs —
 * never a header a remote client set on its own connection.
 */
function clientIp(req) {
  const direct = req.socket?.remoteAddress ?? "unknown";
  const trustProxy = process.env.TRUST_PROXY ?? "loopback";
  if (trustProxy === "false" || !installToken.isLoopbackAddress(direct)) return direct;
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded !== "string" || !forwarded.trim()) return direct;
  const first = forwarded.split(",")[0].trim();
  return first || direct;
}

/**
 * Whether this caller may drive first-run setup.
 *
 * Same rule as POST /api/install: loopback is exempt because reaching the port
 * from the machine itself already implies local access, and everyone else
 * proves they control the files by quoting install-token/TOKEN.txt. Without
 * this, an anonymous peer could spawn npm install on the box, repeatedly, in
 * exactly the window before the site has an administrator.
 */
function bootstrapAuthorised(req, body) {
  if (installToken.isLoopbackAddress(clientIp(req))) return true;
  return installToken.tokenMatches(installToken.tokenFromRequest(req, body), root);
}

/** Fixed-window per-IP limiter for the pre-Express endpoints. */
const bootstrapHits = new Map();
function rateLimited(req, key, max, windowMs) {
  const now = Date.now();
  if (bootstrapHits.size > 5000) bootstrapHits.clear();
  const id = `${key}:${clientIp(req)}`;
  const hit = bootstrapHits.get(id);
  if (!hit || now >= hit.resetAt) {
    bootstrapHits.set(id, { count: 1, resetAt: now + windowMs });
    return false;
  }
  if (hit.count >= max) return true;
  hit.count += 1;
  return false;
}

function readJsonBody(req, maxBytes = 8 * 1024) {
  return new Promise((resolve) => {
    let raw = "";
    let tooBig = false;
    req.on("data", (chunk) => {
      if (tooBig) return;
      raw += chunk;
      if (raw.length > maxBytes) {
        tooBig = true;
        raw = "";
      }
    });
    req.on("end", () => {
      if (tooBig) return resolve(null);
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
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

const adminDist = path.join(root, "apps/server/admin-ui/dist/client");
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

/**
 * Resolve `rel` under `base`, or null if it escapes.
 *
 * The separator matters: a bare startsWith(base) also accepts a sibling whose
 * name merely begins with the same string — `.../admin-ui/dist-backup` passes a
 * prefix test against `.../admin-ui/dist`. realpath then closes the symlink
 * case, so a link planted inside the served directory cannot point out of it.
 * Every other path check in the codebase already worked this way; this one did
 * not, and it is the check in front of the only static route server.js serves.
 */
function safePath(base, rel) {
  const root = path.resolve(base);
  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;

  try {
    const realRoot = fs.realpathSync(root);
    const realResolved = fs.realpathSync(resolved);
    if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path.sep)) return null;
  } catch {
    // Not yet on disk — the lexical check above still applies, and sendFile
    // answers 404 for anything that does not exist.
  }
  return resolved;
}

// Every response from this layer carries the baseline set. These paths — the
// login page, the install wizard, the admin bundle — used to ship with nothing
// but Content-Type, because securityHeaders is Express middleware and Express
// never sees them under Passenger.
//
// `filePath` is opened once (`fsp.open`) and every later check — is it a file,
// read its bytes — runs against that open handle rather than re-resolving
// `filePath` a second and third time. An exists-then-open pair on the same
// path is both a TOCTOU window and the shape CodeQL's path-injection query
// flags as multiple independent filesystem sinks for one tainted path; a
// single open closes both.
async function sendFile(res, filePath) {
  let handle;
  try {
    // codeql[js/path-injection]: both callers already ran filePath through
    // safePath() above (or pass the fixed adminIndex constant) — resolved,
    // contained under base with a trailing-separator check, and realpath'd to
    // close symlink escapes — before it ever reaches this function.
    handle = await fsp.open(filePath, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    if (handle) await handle.close().catch(() => {});
    res.writeHead(404, withSecurityHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(
    200,
    withSecurityHeaders({ "Content-Type": MIME[ext] || "application/octet-stream" }),
  );
  const stream = handle.createReadStream();
  stream.on("error", () => res.end());
  stream.pipe(res);
}

function sendJson(res, status, body) {
  res.writeHead(status, withSecurityHeaders({ "Content-Type": "application/json" }));
  res.end(JSON.stringify(body));
}

/**
 * Dependency-free 500 fallback (justflows-ce#92) for when the full app cannot
 * even boot — no database, cache, or plugin runtime exists yet at this point,
 * so this cannot go through Express or the theme system. It mirrors
 * `apps/server/src/lib/rendering/static-error-page.ts` as an independent copy (this
 * layer runs before that compiled module exists on disk); both read the same
 * `apps/server/{dist,src}/views/static/error-fallback.html` and
 * `lib/i18n/site-catalogs/*.json` files, which are the single source of truth
 * for wording and design — keep the two loaders in sync if either changes.
 * Unlike the full app's version, this one cannot read the admin's custom
 * 500-page text (that setting lives in a database this layer cannot reach),
 * so it always shows the bundled locale-aware default copy.
 */
const STATIC_ERROR_LOCALES = ["en", "de", "es", "fr", "nl"];
const STATIC_ERROR_DEFAULTS = {
  "500": {
    badge: "Temporary error",
    title: "Something went wrong",
    body: "The site hit an unexpected error. Please try again shortly.",
  },
};

function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1];
}

function escapeStaticErrorHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

function detectStaticErrorLocale(pathname, acceptLanguageHeader) {
  const prefix = (pathname.split("/").find(Boolean) || "").toLowerCase().split("-")[0];
  if (STATIC_ERROR_LOCALES.includes(prefix)) return prefix;
  if (acceptLanguageHeader) {
    for (const part of acceptLanguageHeader.split(",")) {
      const code = (part.split(";")[0] || "").trim().toLowerCase().split("-")[0];
      if (STATIC_ERROR_LOCALES.includes(code)) return code;
    }
  }
  return "en";
}

function sendStaticErrorPage(res, status, kind, req) {
  let template;
  try {
    template = fs.readFileSync(
      firstExistingPath([
        path.join(root, "apps/server/dist/views/static/error-fallback.html"),
        path.join(root, "apps/server/src/views/static/error-fallback.html"),
      ]),
      "utf8",
    );
  } catch {
    res.writeHead(status, withSecurityHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    res.end("The site is temporarily unavailable. Please try again shortly.");
    return;
  }

  const locale = detectStaticErrorLocale(
    (req.url ?? "/").split("?")[0],
    req.headers["accept-language"],
  );
  let catalog = {};
  try {
    catalog = JSON.parse(
      fs.readFileSync(
        firstExistingPath([
          path.join(root, `apps/server/dist/lib/i18n/site-catalogs/${locale}.json`),
          path.join(root, `apps/server/src/lib/i18n/site-catalogs/${locale}.json`),
        ]),
        "utf8",
      ),
    );
  } catch {
    catalog = {};
  }

  const defaults = STATIC_ERROR_DEFAULTS[kind];
  const siteTitle = "This site";
  const badge = catalog[`errors.${kind}.badge`] || defaults.badge;
  const heading = catalog[`errors.${kind}.title`] || defaults.title;
  const message = catalog[`errors.${kind}.body`] || defaults.body;
  const html = template
    .replace(/\{\{TITLE\}\}/g, escapeStaticErrorHtml(`${siteTitle} — ${heading}`))
    .replace(/\{\{SITE_TITLE\}\}/g, escapeStaticErrorHtml(siteTitle))
    .replace(/\{\{BADGE\}\}/g, escapeStaticErrorHtml(badge))
    .replace(/\{\{HEADING\}\}/g, escapeStaticErrorHtml(heading))
    .replace(/\{\{MESSAGE\}\}/g, escapeStaticErrorHtml(message));

  res.writeHead(
    status,
    withSecurityHeaders({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" }),
  );
  res.end(html);
}

/**
 * Serve the first-run page with a nonce for its one inline script.
 *
 * The baseline CSP is script-src 'self', which would otherwise blank this page
 * — it is a standalone file with no build step, so its logic is inline. A nonce
 * minted per response keeps the policy strict without pinning a hash that would
 * silently break the page the next time someone edits the script.
 */
function sendBootstrapPage(res, filePath) {
  let html;
  try {
    html = fs.readFileSync(filePath, "utf8");
  } catch {
    res.writeHead(404, withSecurityHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    res.end("Not found");
    return;
  }
  const nonce = randomBytes(16).toString("base64");
  html = html.replace("<script>", `<script nonce="${nonce}">`);
  res.writeHead(
    200,
    withSecurityHeaders({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": ADMIN_CSP.replace(
        "script-src 'self'",
        `script-src 'self' 'nonce-${nonce}'`,
      ),
    }),
  );
  res.end(html);
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
      const app =
        typeof mod.createFullApp === "function" ? await mod.createFullApp() : mod.createApp();
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
      // Mirror the full app's healthz (apps/server/src/server.ts) so callers get
      // the same shape whether or not this bootstrap wrapper is in front — the
      // static exporter reads `installed` to decide it can crawl.
      installed: isInstalled(),
      boot: fullApp ? "ready" : bootError ? "error" : "starting",
      entry: serverEntry() ? path.basename(serverEntry()) : "missing",
    });
    return;
  }

  // codeql[js/user-controlled-bypass]: this is ordinary route dispatch on a
  // fixed literal, not the security check. `pathname` only decides which
  // handler runs; the actual authorization decision inside — whether
  // bootstrapAuthorised()'s caller gets the log tail — is independent of it
  // and is covered by its own doc comment above.
  if (pathname === "/api/bootstrap/status") {
    if (rateLimited(req, "status", 240, 60_000)) {
      sendJson(res, 429, { error: "Too many requests" });
      return;
    }
    // Once installed this answers with nothing but the flag the setup page
    // needs to redirect. Everything else here — the job record, whether this is
    // a git checkout, and above all the installer log — described the host to
    // any anonymous caller, on a route that never checked install state.
    if (isInstalled()) {
      sendJson(res, 200, { installed: true });
      return;
    }
    const tokenRequired = !installToken.isLoopbackAddress(clientIp(req));
    // The log is the npm transcript: absolute paths, the full dependency tree,
    // and any build error. Released only to a caller who has proved control of
    // the files, which by this point in the flow the setup page has.
    const authorised = bootstrapAuthorised(req, null);
    sendJson(res, 200, {
      installed: false,
      gitCheckout: gate.isGitCheckout(root),
      allowed: gate.bootstrapSpawnAllowed(root),
      ready: gate.depsReady(root),
      job: gate.jobStatus(root),
      tokenRequired,
      tokenFile: installToken.installTokenFileExists(root) ? "install-token/TOKEN.txt" : null,
      log: authorised ? gate.readLogTail(root) : "",
    });
    return;
  }

  if (pathname === "/api/bootstrap" && req.method === "POST") {
    if (rateLimited(req, "spawn", 10, 60_000)) {
      sendJson(res, 429, { error: "Too many requests" });
      return;
    }
    if (crossOriginRequest(req)) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }
    if (isInstalled()) {
      sendJson(res, 409, { error: "Already installed" });
      return;
    }
    readJsonBody(req).then((body) => {
      // Spawning the installer runs npm install and a full build. Gate it the
      // same way POST /api/install is gated, so an anonymous peer cannot drive
      // work on the box during the one window where the site has no owner.
      if (!bootstrapAuthorised(req, body)) {
        sendJson(res, 403, {
          error: installToken.installTokenFileExists(root)
            ? "Enter the setup key from install-token/TOKEN.txt in your site's folder."
            : "A setup key is required. Restart the app to generate one — it is written to install-token/TOKEN.txt and printed to the server log.",
          tokenRequired: true,
        });
        return;
      }
      if (gate.depsReady(root)) {
        sendJson(res, 200, { ok: true, ready: true });
        return;
      }
      if (!gate.bootstrapSpawnAllowed(root)) {
        sendJson(res, 403, {
          error:
            "Browser setup is only available on an unzipped release, before the site is installed.",
        });
        return;
      }
      const result = startBootstrap();
      if (!result.started) {
        sendJson(res, 409, { error: "Setup is already running", reason: result.reason });
        return;
      }
      sendJson(res, 202, { ok: true, started: true });
    });
    return;
  }

  if (pathname === "/" && !isInstalled()) {
    if (gate.bootstrapPageEnabled(root) && !gate.isGitCheckout(root)) {
      sendBootstrapPage(res, gate.indexHtmlPath(root));
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
    .catch(() => {
      // bootFullApp() already logged the real error server-side. The response
      // must never carry err.message — on a database failure that can be a
      // connection string, on anything else it can be an internal file path.
      if (!res.headersSent) {
        sendStaticErrorPage(res, 503, "500", req);
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
  // 0.0.0.0 / :: mean "bind every interface"; they are not browsable and are not
  // a secure context (crypto.randomUUID is undefined), so display localhost.
  const displayHost = ["0.0.0.0", "::", ""].includes(host) ? "localhost" : host;
  server.listen(port, host, () => {
    console.log(`> Justflows ready on http://${displayHost}:${port}`);
    console.log(`> Open that URL in a browser to install`);
  });
}
