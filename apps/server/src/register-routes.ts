import type express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { getJfRoot } from "./lib/jf-root.js";
import { requireInstalled, blockIfInstalled } from "./middleware/install-guard.js";
import { publicApiGuard } from "./middleware/public-api.js";
import { getSession } from "./lib/session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Register heavy routes (dynamic import — keeps Passenger startup fast). */
export async function registerDeferredRoutes(app: express.Application): Promise<void> {
  const { ensurePluginRuntime } = await import("./lib/plugin-runtime.js");
  await ensurePluginRuntime();

  const [
    { default: contentRoutes },
    { default: mediaRoutes },
    { default: commentsRoutes },
    { default: usersRoutes },
    { default: settingsRoutes },
    { default: securityRoutes },
    { default: themesRoutes },
    { default: cssProvidersRoutes, cssProviderAssetsRouter },
    { default: pluginsRoutes },
    { default: marketplaceRoutes },
    { default: publicApiRoutes, healthRouter },
    { default: updatesRoutes, dbRouter },
    { default: cacheRoutes },
    { default: performanceRoutes },
    { default: importRoutes },
    { default: siteRoutes, serveThemeCss },
    { default: publicSiteRoutes },
    { default: languagesRoutes },
    { default: menusRoutes },
    { default: blocksRoutes },
    { default: analyticsRoutes },
    { default: formsRoutes },
  ] = await Promise.all([
    import("./routes/content.js"),
    import("./routes/media.js"),
    import("./routes/comments.js"),
    import("./routes/users.js"),
    import("./routes/settings.js"),
    import("./routes/security.js"),
    import("./routes/themes.js"),
    import("./routes/css-providers.js"),
    import("./routes/plugins.js"),
    import("./routes/marketplace.js"),
    import("./routes/public-api.js"),
    import("./routes/updates.js"),
    import("./routes/cache.js"),
    import("./routes/performance.js"),
    import("./routes/import.js"),
    import("./routes/site.js"),
    import("./routes/public-site.js"),
    import("./routes/languages.js"),
    import("./routes/menus.js"),
    import("./routes/blocks.js"),
    import("./routes/analytics.js"),
    import("./routes/forms.js"),
  ]);

  app.use(blockIfInstalled);

  app.use("/api/content", requireInstalled, contentRoutes);
  app.use("/api/media", requireInstalled, mediaRoutes);
  app.use("/api/comments", requireInstalled, commentsRoutes);
  app.use("/api/users", requireInstalled, usersRoutes);
  app.use("/api/settings", requireInstalled, settingsRoutes);
  app.use("/api/security", requireInstalled, securityRoutes);
  app.use("/api/themes", requireInstalled, themesRoutes);
  app.use("/api/css-providers", requireInstalled, cssProvidersRoutes);
  app.use("/css-providers", requireInstalled, cssProviderAssetsRouter);
  app.use("/api/plugins", requireInstalled, pluginsRoutes);
  app.use("/api/marketplace", requireInstalled, marketplaceRoutes);
  app.use("/api/health", requireInstalled, healthRouter);
  app.use("/api/updates", requireInstalled, updatesRoutes);
  app.use("/api/cache", requireInstalled, cacheRoutes);
  app.use("/api/performance", requireInstalled, performanceRoutes);
  app.use("/api/db", requireInstalled, dbRouter);
  app.use("/api/import", requireInstalled, importRoutes);
  app.use("/api/languages", requireInstalled, languagesRoutes);
  app.use("/api/menus", requireInstalled, menusRoutes);
  app.use("/api/blocks", requireInstalled, blocksRoutes);
  app.use("/api/analytics", requireInstalled, analyticsRoutes);
  app.use("/api/forms", requireInstalled, formsRoutes);
  // Everything below is public-facing: one switch (Settings → Public API) takes
  // the whole surface offline. Mounted on the prefix so future public routes
  // inherit the guard automatically.
  app.use("/api/v1", publicApiGuard);
  app.use("/api/site", publicApiGuard);

  app.use("/api/v1/content", publicApiRoutes);
  app.use("/api/site", siteRoutes);
  app.get("/theme.css", serveThemeCss);

  app.post("/justflows-forms/submit", requireInstalled, async (req, res) => {
    try {
      const { acceptFormSubmission } = await import("./lib/forms-public.js");
      const result = await acceptFormSubmission({
        body: (req.body ?? {}) as Record<string, unknown>,
        referer: req.get("referer") ?? "/",
      });
      if (result.location) {
        res.status(result.status === 303 ? 303 : result.status).location(result.location).end();
        return;
      }
      res.status(result.status).type("html").send(result.error ?? "Unable to submit");
    } catch (err) {
      res.status(500).type("html").send(String(err));
    }
  });

  app.get("/sitemap.xml", requireInstalled, async (_req, res, next) => {
    try {
      const { isSeoPluginActive, buildSitemapXml } = await import("./lib/seo-public.js");
      const { getSiteId } = await import("./lib/themes-db.js");
      const siteId = await getSiteId();
      if (!siteId || !(await isSeoPluginActive(siteId))) {
        next();
        return;
      }
      res.type("application/xml").send(await buildSitemapXml(siteId));
    } catch (err) {
      res.status(500).type("text/plain").send(String(err));
    }
  });

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

  app.use("/admin", requireInstalled, (req, res, next) => {
    if (req.path.match(/\.\w+$/)) {
      next();
      return;
    }
    if (!getSession(req)) {
      res.redirect("/login");
      return;
    }
    next();
  });

  app.get(/^\/admin(\/.+)?$/, requireInstalled, (req, res, next) => {
    if (req.path.match(/\.\w+$/)) {
      next();
      return;
    }
    sendAdminSpa(req, res);
  });

  app.use(requireInstalled, (await import("./lib/plugin-http.js")).dispatchPluginHttp);
  app.use(requireInstalled, publicSiteRoutes);
}
