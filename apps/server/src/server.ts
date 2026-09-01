// SPDX-License-Identifier: MIT

import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

import { uploadsDir, getJfRoot, viewsDir } from "./lib/jf-root.js";
import { isInstalled } from "./middleware/install-guard.js";
import { installToken, installTokenRequired } from "./lib/install-token.js";
import { serveAdminI18n } from "./lib/i18n/admin-catalog.js";
import { csrfProtection } from "./middleware/csrf.js";
import { setCsrfCookie } from "./lib/session.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { cacheTraceMiddleware } from "./middleware/cache-trace.js";
import { createGzipMiddleware } from "./middleware/gzip.js";
import { browserCacheMiddleware, staticMaxAgeMs } from "./middleware/browser-cache.js";
import { rateLimit } from "express-rate-limit";
import { adminClientDir, adminClientIndex } from "./lib/admin-ssr.js";

let corePromise: Promise<void> | null = null;
let deferredLoaded = false;
let deferredPromise: Promise<void> | null = null;

function ensureCoreRoutes(app: express.Application): Promise<void> {
  if (!corePromise) {
    corePromise = (async () => {
      const [{ default: authRoutes }, { default: installRoutes }] = await Promise.all([
        import("./routes/auth.js"),
        import("./routes/install.js"),
      ]);

      app.use("/api/auth", authRoutes);
      app.use("/api/install", installRoutes);
    })();
  }
  return corePromise;
}

function loadDeferredRoutes(app: express.Application): Promise<void> {
  if (deferredLoaded) return Promise.resolve();
  if (!deferredPromise) {
    deferredPromise = import("./register-routes.js")
      .then((m) => m.registerDeferredRoutes(app))
      .then(() => {
        deferredLoaded = true;
      });
  }
  return deferredPromise;
}

export function createApp(): express.Application {
  const app = express();

  // Justflows is normally deployed behind nginx, Passenger, or a Docker proxy.
  // Without this, req.ip is the proxy's address for every request, which
  // collapses per-IP rate limiting into one shared bucket and makes req.secure
  // always false. Defaults to "loopback" — the reverse proxy on the same host —
  // and TRUST_PROXY accepts anything Express does ("1", a subnet, "false").
  const trustProxy = process.env.TRUST_PROXY ?? "loopback";
  if (trustProxy !== "false") {
    app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Powered-By", "Justflows");
    next();
  });
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      void import("./lib/plugin-runtime.js")
        .then(({ getRuntimeHooks }) =>
          getRuntimeHooks().dispatchAction(
            "request.after",
            {
              method: req.method,
              path: req.path,
              statusCode: res.statusCode,
              durationMs: Date.now() - started,
            },
            { source: "http" },
          ),
        )
        .catch(() => undefined);
    });
    next();
  });
  app.use(createGzipMiddleware());
  app.use(cacheTraceMiddleware);
  app.use(browserCacheMiddleware);
  // Registered before anything that can send a response so every route
  // inherits the policy — csrfProtection included, since it answers 403 itself
  // and those responses used to go out bare.
  app.use(securityHeaders);

  app.use("/api", csrfProtection);

  const staticMaxAge = staticMaxAgeMs();
  app.use(
    "/uploads",
    express.static(uploadsDir(), {
      maxAge: staticMaxAge,
      setHeaders: (res, filePath) => {
        // A PDF rendered inline runs in this origin's context, where its own
        // scripting and form actions apply. Uploads are user content, so hand
        // them to the viewer as a download instead.
        if (filePath.toLowerCase().endsWith(".pdf")) {
          res.setHeader("Content-Disposition", "attachment");
        }
      },
    }),
  );
  app.use(express.static(path.join(getJfRoot(), "public"), { maxAge: staticMaxAge }));

  app.set("view engine", "ejs");
  app.set("views", viewsDir());

  app.get("/api/healthz", (_req, res) => {
    res.json({ ok: true, installed: isInstalled(), boot: deferredLoaded ? "ready" : "loading" });
  });

  app.get("/api/i18n/:locale", serveAdminI18n);

  const sendAdminSpa = (_req: express.Request, res: express.Response) => {
    const indexPath = adminClientIndex();
    res.sendFile(indexPath, (err) => {
      if (!err || res.headersSent) return;
      res.status(503).send("Admin UI not built.");
    });
  };

  const adminStatic = adminClientDir();
  if (fs.existsSync(adminStatic)) {
    app.use("/assets", express.static(path.join(adminStatic, "assets")));
  }

  // Login is no longer exempt from CSRF, so the page that submits it needs a
  // token before a session exists. Issuing it with the HTML means the attacker
  // has to be able to write a cookie on this domain, not merely post a form.
  // CodeQL js/missing-rate-limiting only models express-rate-limit (not a
  // custom consumeRateLimit helper) as middleware that guards sendFile.
  const authPageRateLimit = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: "Too many requests",
  });

  const withCsrfCookie = (req: express.Request, res: express.Response) => {
    if (!req.cookies?.jf_csrf) setCsrfCookie(res);
    sendAdminSpa(req, res);
  };

  app.get("/install", authPageRateLimit, withCsrfCookie);
  app.get("/login", authPageRateLimit, withCsrfCookie);
  app.get("/register", authPageRateLimit, withCsrfCookie);
  app.get("/forgot-password", authPageRateLimit, withCsrfCookie);
  // The reset link carries a token in the query string. Keep it out of any
  // Referer header the page would otherwise send when it loads a subresource or
  // the user clicks away; the page itself also strips it from the URL on load.
  app.get(
    "/reset-password",
    authPageRateLimit,
    (req: express.Request, res: express.Response) => {
      res.setHeader("Referrer-Policy", "no-referrer");
      withCsrfCookie(req, res);
    },
  );

  app.get("/", (req, res, next) => {
    if (isInstalled()) {
      next();
      return;
    }
    res.redirect("/install");
  });

  if (isPassenger()) {
    app.use((req, res, next) => {
      if (deferredLoaded) {
        next();
        return;
      }
      Promise.all([ensureCoreRoutes(app), loadDeferredRoutes(app)])
        .then(() => {
          (
            app as unknown as {
              handle: (
                req: express.Request,
                res: express.Response,
                next: express.NextFunction,
              ) => void;
            }
          ).handle(req, res, next);
        })
        .catch(next);
    });
  }

  return app;
}

/** Load all routes before handling requests (used by Passenger after spawn). */
export async function createFullApp(): Promise<express.Application> {
  const app = createApp();
  await ensureCoreRoutes(app);
  await loadDeferredRoutes(app);
  return app;
}

export async function startServer(): Promise<void> {
  if (isPassenger()) {
    throw new Error("startServer() must not run under Passenger — use root server.js");
  }

  if (!process.env.JF_ROOT) {
    process.env.JF_ROOT = getJfRoot();
  }

  const app = createApp();
  await ensureCoreRoutes(app);
  await loadDeferredRoutes(app);

  if (!isInstalled() && installTokenRequired()) {
    installToken();
  }

  const port = parseInt(process.env.PORT ?? "3000", 10);
  const hostname = process.env.HOSTNAME ?? "0.0.0.0";

  app.listen(port, hostname, () => {
    console.log(`> Justflows ready on http://${hostname}:${port}`);
    console.log(`> Install: http://${hostname}:${port}/install`);
  });
}

export function isPassenger(): boolean {
  return !!(
    process.env.PASSENGER_APP_ENV ||
    process.env.PASSENGER_LISTEN_PORT ||
    process.env.PHUSION_PASSENGER ||
    process.env.PASSENGER_APP_ENV_NAME ||
    process.env._PASSENGER_APP_ROOT
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
