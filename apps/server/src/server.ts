// SPDX-License-Identifier: MIT

import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

import { uploadsDir, getJfRoot, viewsDir } from "./lib/jf-root.js";
import { isInstalled } from "./middleware/install-guard.js";
import { serveAdminI18n } from "./lib/i18n/admin-catalog.js";
import { csrfProtection } from "./middleware/csrf.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { cacheTraceMiddleware } from "./middleware/cache-trace.js";
import { createGzipMiddleware } from "./middleware/gzip.js";
import { browserCacheMiddleware, staticMaxAgeMs } from "./middleware/browser-cache.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  app.use("/api", csrfProtection);

  // Configurable per site from Admin → Security. Registered before anything
  // that can send a response so every route inherits the policy.
  app.use(securityHeaders);

  const staticMaxAge = staticMaxAgeMs();
  app.use("/uploads", express.static(uploadsDir(), { maxAge: staticMaxAge }));
  app.use(express.static(path.join(getJfRoot(), "public"), { maxAge: staticMaxAge }));

  app.set("view engine", "ejs");
  app.set("views", viewsDir());

  app.get("/api/healthz", (_req, res) => {
    res.json({ ok: true, installed: isInstalled(), boot: deferredLoaded ? "ready" : "loading" });
  });

  app.get("/api/i18n/:locale", serveAdminI18n);

  const adminDist = path.join(getJfRoot(), "apps/server/admin-ui/dist");
  const adminDistAlt = path.join(__dirname, "../admin-ui/dist");
  const adminStatic = fs.existsSync(adminDist) ? adminDist : adminDistAlt;

  const sendAdminSpa = (_req: express.Request, res: express.Response) => {
    const indexPath = path.join(adminStatic, "index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(503).send("Admin UI not built.");
    }
  };

  if (fs.existsSync(adminStatic)) {
    app.use("/assets", express.static(path.join(adminStatic, "assets")));
  }

  app.get("/install", sendAdminSpa);
  app.get("/login", sendAdminSpa);
  app.get("/register", sendAdminSpa);

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
          (app as unknown as { handle: (req: express.Request, res: express.Response, next: express.NextFunction) => void }).handle(
            req,
            res,
            next,
          );
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
