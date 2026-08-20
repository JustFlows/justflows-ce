import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  clearThemeDraft,
  defaultModsFromSchema,
  getCustomizeSchema,
  getEffectiveThemeCss,
  getSiteIdentity,
  getThemeMods,
  mergeMods,
  publishThemeMods,
  saveThemeMods,
  type ThemeMods,
} from "../lib/theme-customize.js";
import {
  clearThemeHomeDraft,
  defaultHomeBlocksFromTheme,
  getEffectiveHomeBlocks,
  getThemeHomeBlocks,
  publishThemeHomeBlocks,
  saveThemeHomeBlocks,
} from "../lib/theme-home-blocks.js";
import { normalizeBlocks } from "../lib/content-api.js";
import { revalidateOnUpdate } from "../lib/cache-revalidate.js";
import {
  listThemePatterns,
  loadThemePattern,
} from "../lib/theme-files.js";
import {
  activateTheme,
  ensureThemesTable,
  getActiveTheme,
  getSiteId,
  insertTheme,
  listThemes,
  themeInstalledPath,
} from "../lib/themes-db.js";
import { requireRole } from "../middleware/auth.js";
import { THEME_CUSTOMIZE_ROLES } from "../lib/rbac.js";
import { param } from "../lib/params.js";
import multer from "multer";
import { assertPackageIsTrusted } from "../lib/package-trust.js";
import { packagesInstalledDir } from "../lib/packages-dir.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function extractCssVariables(manifest: Record<string, unknown>): Record<string, string> {
  const vars = (manifest.cssVariables ?? manifest.css_variables ?? {}) as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (typeof v === "string") result[k] = v;
  }
  return result;
}

router.get("/", async (_req, res) => {
  try {
    await ensureThemesTable();
    const siteId = await getSiteId();
    if (!siteId) {
      res.json({ themes: [] });
      return;
    }
    const themes = await listThemes(siteId);
    res.json({ themes });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/", requireRole("administrator"), upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }
    if (!file.originalname.endsWith(".jfpkg") && !file.originalname.endsWith(".zip")) {
      res.status(400).json({ error: "Only .jfpkg files are accepted" });
      return;
    }

    const { PackageInstaller } = await import("@justflows/installer");
    const installer = new PackageInstaller();
    const packagesDir = packagesInstalledDir();

    const result = await installer.installFromBuffer(file.buffer, {
      packagesDir,
      source: "upload",
    });

    if (result.manifest.type !== "theme") {
      res.status(400).json({ error: "Uploaded package is not a theme (manifest.type must be 'theme')" });
      return;
    }

    assertPackageIsTrusted(result.manifest as unknown as Record<string, unknown>, result.digest);

    await ensureThemesTable();
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found — complete install first" });
      return;
    }

    const manifest = result.manifest as Record<string, unknown>;
    const cssVariables = extractCssVariables(manifest);

    const theme = {
      id: randomUUID(),
      themeId: result.manifest.id,
      name: result.manifest.name,
      version: result.manifest.version,
      publisher: result.manifest.publisher,
      description: result.manifest.description,
      cssVariables,
      manifest,
    };

    await insertTheme(siteId, theme);
    res.json({ theme: { ...theme, status: "installed", active: false } });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/patterns", async (_req, res) => {
  try {
    await ensureThemesTable();
    const siteId = await getSiteId();
    const theme = siteId ? await getActiveTheme(siteId) : null;
    const themeId = theme?.theme_id ?? "justflows.default";
    res.json({ patterns: listThemePatterns(themeId, themeInstalledPath(theme)) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/patterns/:slug", async (req, res) => {
  try {
    await ensureThemesTable();
    const siteId = await getSiteId();
    const theme = siteId ? await getActiveTheme(siteId) : null;
    const themeId = theme?.theme_id ?? "justflows.default";
    const pattern = loadThemePattern(themeId, req.params.slug!, themeInstalledPath(theme));
    if (!pattern) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }
    res.json({ pattern });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/:id/activate", requireRole("administrator"), async (req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found" });
      return;
    }
    const themeId = param(req.params.id);
    await activateTheme(siteId, themeId);
    await revalidateOnUpdate("theme", { siteId });
    try {
      const { getDb } = await import("../lib/db.js");
      const { getRuntimeHooks } = await import("../lib/plugin-runtime.js");
      const db = await getDb();
      const rows = await db.query<{ version: string }>(
        "SELECT version FROM themes WHERE site_id = ? AND theme_id = ? LIMIT 1",
        [siteId, themeId],
      );
      await getRuntimeHooks().dispatchAction(
        "theme.activated",
        { themeId, version: rows[0]?.version ?? "0.0.0", siteId },
        { siteId, source: "http" },
      );
    } catch {
      // hooks must not block theme activation
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const ModsSchema = z.object({
  identity: z.record(z.string(), z.string()).optional(),
  colors: z.record(z.string(), z.string()).optional(),
  typography: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  layout: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  navigation: z.record(z.string(), z.string()).optional(),
  advanced: z.record(z.string(), z.string()).optional(),
});

const BlockDocumentSchema = z.object({
  version: z.literal(1).default(1),
  blocks: z.array(z.record(z.string(), z.unknown())),
});

const PatchSchema = z.object({
  mods: ModsSchema.optional(),
  blocks: BlockDocumentSchema.optional(),
  draft: z.boolean().default(true),
  publish: z.boolean().default(false),
});

router.get("/customize", requireRole(...THEME_CUSTOMIZE_ROLES), async (_req, res) => {
  try {
    await ensureThemesTable();
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found" });
      return;
    }

    const theme = await getActiveTheme(siteId);
    if (!theme) {
      res.status(404).json({ error: "No active theme — activate a theme first" });
      return;
    }

    const defaults = defaultModsFromSchema();
    const published = (await getThemeMods(theme.theme_id, false)) ?? {};
    const draft = (await getThemeMods(theme.theme_id, true)) ?? {};
    const effective = mergeMods(mergeMods(defaults, published), draft);
    const identity = await getSiteIdentity(effective);
    effective.identity = {
      ...effective.identity,
      siteTitle: identity.siteTitle,
      tagline: identity.tagline,
    };

    const homeDraft = (await getThemeHomeBlocks(theme.theme_id, true)) ?? null;
    const homePublished = (await getThemeHomeBlocks(theme.theme_id, false)) ?? null;
    const defaultBlocks = defaultHomeBlocksFromTheme(theme.theme_id);
    const effectiveBlocks = await getEffectiveHomeBlocks(theme.theme_id, true);

    res.json({
      theme: { id: theme.theme_id, name: theme.name, version: theme.version },
      schema: await getCustomizeSchema(siteId),
      mods: effective,
      blocks: effectiveBlocks,
      defaultBlocks,
      published: mergeMods(defaults, published),
      publishedBlocks: homePublished?.blocks.length ? homePublished : null,
      hasDraft: Object.keys(draft).length > 0 || Boolean(homeDraft?.blocks.length),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.patch("/customize", requireRole(...THEME_CUSTOMIZE_ROLES), async (req, res) => {
  try {
    const body = PatchSchema.parse(req.body);
    await ensureThemesTable();
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found" });
      return;
    }

    const theme = await getActiveTheme(siteId);
    if (!theme) {
      res.status(404).json({ error: "No active theme" });
      return;
    }

    const defaults = defaultModsFromSchema();
    const published = (await getThemeMods(theme.theme_id, false)) ?? {};
    const base = mergeMods(defaults, published);
    const currentMods = mergeMods(base, (await getThemeMods(theme.theme_id, true)) ?? {});
    const mods = body.mods ? mergeMods(base, body.mods as ThemeMods) : currentMods;

    const currentBlocks = await getEffectiveHomeBlocks(theme.theme_id, true);
    const blocks = body.blocks ? normalizeBlocks(body.blocks) : currentBlocks;

    if (body.publish) {
      await publishThemeMods(theme.theme_id, mods);
      await publishThemeHomeBlocks(theme.theme_id, blocks);
      await revalidateOnUpdate("theme");
      res.json({ ok: true, published: true, mods, blocks });
      return;
    }

    await saveThemeMods(theme.theme_id, mods, body.draft);
    await saveThemeHomeBlocks(theme.theme_id, blocks, body.draft);
    await revalidateOnUpdate("theme");
    res.json({ ok: true, published: false, mods, blocks });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("Custom CSS") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

router.delete("/customize", requireRole(...THEME_CUSTOMIZE_ROLES), async (_req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found" });
      return;
    }
    const theme = await getActiveTheme(siteId);
    if (!theme) {
      res.status(404).json({ error: "No active theme" });
      return;
    }

    await clearThemeDraft(theme.theme_id);
    await clearThemeHomeDraft(theme.theme_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
