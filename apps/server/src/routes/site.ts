import { Router } from "express";
import {
  defaultModsFromSchema,
  getEffectiveThemeCss,
  getNavigationMenuSlugs,
  getSiteIdentity,
  getThemeMods,
  mergeMods,
} from "../lib/theme-customize.js";
import { ensureThemesTable, getActiveTheme, getSiteId } from "../lib/themes-db.js";
import { isPreviewAllowed } from "../lib/auth-session.js";
import { getGeneralSettings } from "../lib/general-settings.js";
import { isSafeScopeSelector, scopeThemeCss } from "../lib/scope-css.js";

const router = Router();

router.get("/identity", async (req, res) => {
  try {
    await ensureThemesTable();
    const siteId = await getSiteId();
    if (!siteId) {
      res.json({ siteTitle: "My Site", tagline: "", logoUrl: "", faviconUrl: "" });
      return;
    }

    const preview = await isPreviewAllowed(req, res);
    const theme = await getActiveTheme(siteId);
    const themeId = theme?.theme_id ?? "justflows.default";

    const defaults = defaultModsFromSchema();
    const published = (await getThemeMods(themeId, false)) ?? {};
    const draft = preview ? ((await getThemeMods(themeId, true)) ?? {}) : {};
    const mods = mergeMods(mergeMods(defaults, published), draft);

    const identity = await getSiteIdentity(mods, { preview });
    const general = await getGeneralSettings(siteId);
    const nav = getNavigationMenuSlugs(mods);
    res.json({
      ...identity,
      headerMenu: nav.header ?? "primary",
      timezone: general.timezone,
      dateFormat: general.dateFormat,
      timeFormat: general.timeFormat,
      startOfWeek: general.startOfWeek,
    });
  } catch {
    res.json({ siteTitle: "My Site", tagline: "", logoUrl: "", faviconUrl: "" });
  }
});

export default router;

export async function serveThemeCss(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  const preview = await isPreviewAllowed(req, res);
  // `?scope=.jf-theme-surface` confines the whole sheet to one subtree so the
  // page builder can link it without repainting the admin chrome.
  const scopeParam = typeof req.query.scope === "string" ? req.query.scope : "";
  const scope = isSafeScopeSelector(scopeParam) ? scopeParam : "";
  try {
    let css = await getEffectiveThemeCss(preview);
    if (scope) css = scopeThemeCss(css, scope);
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    res.setHeader(
      "Cache-Control",
      preview ? "no-store" : "public, max-age=60, stale-while-revalidate=300",
    );
    res.send(css);
  } catch {
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    res.send(":root {}\n");
  }
}
