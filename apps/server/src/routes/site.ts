import { Router } from "express";
import {
  defaultModsFromSchema,
  getEffectiveThemeCss,
  getSiteIdentity,
  getThemeMods,
  mergeMods,
} from "../lib/theme-customize.js";
import { ensureThemesTable, getActiveTheme, getSiteId } from "../lib/themes-db.js";
import { isPreviewAllowed } from "../lib/auth-session.js";
import { getGeneralSettings } from "../lib/general-settings.js";

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
    res.json({
      ...identity,
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

export async function serveThemeCss(req: import("express").Request, res: import("express").Response): Promise<void> {
  const preview = await isPreviewAllowed(req, res);
  try {
    const css = await getEffectiveThemeCss(preview);
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    res.setHeader("Cache-Control", preview ? "no-store" : "public, max-age=60, stale-while-revalidate=300");
    res.send(css);
  } catch {
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    res.send(":root {}\n");
  }
}
