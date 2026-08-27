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
import {
  clearThemeBlogDraft,
  defaultBlogBlocksFromTheme,
  getEffectiveBlogBlocks,
  getThemeBlogBlocks,
  publishThemeBlogBlocks,
  saveThemeBlogBlocks,
} from "../lib/theme-blog-blocks.js";
import { normalizeBlocks, serializeContentRow } from "../lib/content-api.js";
import { revalidateOnUpdate } from "../lib/cache-revalidate.js";
import { getHomePageId, setHomePageId } from "../lib/home-page.js";
import { getBlogPageId, setBlogPageId } from "../lib/blog-page.js";
import { getDb } from "../lib/db.js";
import { getDefaultLocale } from "../lib/i18n/languages-db.js";
import { sanitizeBlockDocument } from "@justflows/blocks";
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
import { CONTENT_READ_ROLES, THEME_CUSTOMIZE_ROLES } from "../lib/rbac.js";
import { param } from "../lib/params.js";
import multer from "multer";
import { assertPackageIsTrusted } from "../lib/package-trust.js";
import { sendPackageInstallError } from "../lib/package-install-error.js";
import { packagesInstalledDir } from "../lib/packages-dir.js";
import { auditFromRequest } from "../lib/audit-log.js";
import { sendServerError } from "../lib/send-error.js";

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

router.get("/", requireRole(...THEME_CUSTOMIZE_ROLES), async (_req, res) => {
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
    sendServerError(res, "themes", err);
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

    // Verified inside the installer, while the package is still staged — see
    // the note on InstallOptions.verify.
    const result = await installer.installFromBuffer(file.buffer, {
      packagesDir,
      source: "upload",
      verify: (manifest, digest) => {
        if (manifest.type !== "theme") {
          throw new Error("Uploaded package is not a theme (manifest.type must be 'theme')");
        }
        assertPackageIsTrusted(manifest as unknown as Record<string, unknown>, digest);
      },
    });

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
    auditFromRequest(req, "theme.installed", {
      target: result.manifest.id,
      detail: `version=${result.manifest.version} digest=${result.digest.slice(0, 16)}`,
    });
    res.json({ theme: { ...theme, status: "installed", active: false } });
  } catch (err) {
    sendPackageInstallError(res, err);
  }
});

router.get("/patterns", requireRole(...CONTENT_READ_ROLES), async (_req, res) => {
  try {
    await ensureThemesTable();
    const siteId = await getSiteId();
    const theme = siteId ? await getActiveTheme(siteId) : null;
    const themeId = theme?.theme_id ?? "justflows.default";
    res.json({ patterns: listThemePatterns(themeId, themeInstalledPath(theme)) });
  } catch (err) {
    sendServerError(res, "themes", err);
  }
});

router.get("/patterns/:slug", requireRole(...CONTENT_READ_ROLES), async (req, res) => {
  try {
    await ensureThemesTable();
    const siteId = await getSiteId();
    const theme = siteId ? await getActiveTheme(siteId) : null;
    const themeId = theme?.theme_id ?? "justflows.default";
    const pattern = loadThemePattern(themeId, param(req.params.slug), themeInstalledPath(theme));
    if (!pattern) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }
    res.json({ pattern });
  } catch (err) {
    sendServerError(res, "themes", err);
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
    auditFromRequest(req, "theme.activated", { target: themeId, siteId });
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
    sendServerError(res, "themes", err);
  }
});

const ModsSchema = z.object({
  identity: z.record(z.string(), z.string()).optional(),
  colors: z.record(z.string(), z.string()).optional(),
  colorsDark: z.record(z.string(), z.string()).optional(),
  typography: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  headings: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  spacing: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  radius: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  shadow: z.record(z.string(), z.string()).optional(),
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
  homePageId: z.string().uuid().nullable().optional(),
  blogBlocks: BlockDocumentSchema.optional(),
  blogPageId: z.string().uuid().nullable().optional(),
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
    const homePageId = await getHomePageId(siteId);
    const blogDraft = (await getThemeBlogBlocks(theme.theme_id, true)) ?? null;
    const blogPublished = (await getThemeBlogBlocks(theme.theme_id, false)) ?? null;
    const defaultBlogBlocks = defaultBlogBlocksFromTheme(theme.theme_id);
    const effectiveBlogBlocks = await getEffectiveBlogBlocks(theme.theme_id, true);
    const blogPageId = await getBlogPageId(siteId);
    const db = await getDb();
    const pageRows = await db.query<{
      id: string;
      title: string;
      slug: string;
      locale: string;
      status: string;
    }>(
      "SELECT id, title, slug, locale, status FROM content WHERE site_id = ? AND type = 'page' ORDER BY title ASC",
      [siteId],
    );

    res.json({
      theme: { id: theme.theme_id, name: theme.name, version: theme.version },
      schema: await getCustomizeSchema(siteId),
      mods: effective,
      blocks: effectiveBlocks,
      defaultBlocks,
      published: mergeMods(defaults, published),
      publishedBlocks: homePublished?.blocks.length ? homePublished : null,
      hasDraft:
        Object.keys(draft).length > 0 ||
        Boolean(homeDraft?.blocks.length) ||
        Boolean(blogDraft?.blocks.length),
      homePageId,
      blogBlocks: effectiveBlogBlocks,
      defaultBlogBlocks,
      publishedBlogBlocks: blogPublished?.blocks.length ? blogPublished : null,
      blogPageId,
      pages: pageRows.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        slug: String(row.slug),
        locale: String(row.locale ?? "en-US"),
        status: String(row.status),
      })),
    });
  } catch (err) {
    sendServerError(res, "themes", err);
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
    const homePageId =
      body.homePageId !== undefined ? await setHomePageId(siteId, body.homePageId) : await getHomePageId(siteId);

    const currentBlogBlocks = await getEffectiveBlogBlocks(theme.theme_id, true);
    const blogBlocks = body.blogBlocks ? normalizeBlocks(body.blogBlocks) : currentBlogBlocks;
    const blogPageId =
      body.blogPageId !== undefined ? await setBlogPageId(siteId, body.blogPageId) : await getBlogPageId(siteId);

    if (body.publish) {
      await publishThemeMods(theme.theme_id, mods);
      await publishThemeHomeBlocks(theme.theme_id, blocks);
      await publishThemeBlogBlocks(theme.theme_id, blogBlocks);
      await revalidateOnUpdate("theme");
      res.json({ ok: true, published: true, mods, blocks, homePageId, blogBlocks, blogPageId });
      return;
    }

    await saveThemeMods(theme.theme_id, mods, body.draft);
    await saveThemeHomeBlocks(theme.theme_id, blocks, body.draft);
    await saveThemeBlogBlocks(theme.theme_id, blogBlocks, body.draft);
    await revalidateOnUpdate("theme");
    res.json({ ok: true, published: false, mods, blocks, homePageId, blogBlocks, blogPageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("Custom CSS") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

router.post("/customize/promote-home", requireRole(...THEME_CUSTOMIZE_ROLES), async (req, res) => {
  try {
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

    const session = req.session!;
    const blocks = await getEffectiveHomeBlocks(theme.theme_id, true);
    const locale = await getDefaultLocale();
    const db = await getDb();
    const candidates = ["home", "homepage", "front"];
    let slug = "home";
    for (const candidate of candidates) {
      const existing = await db.query<{ id: string }>(
        "SELECT id FROM content WHERE site_id = ? AND type = 'page' AND slug = ? AND locale = ? LIMIT 1",
        [siteId, candidate, locale],
      );
      if (!existing[0]) {
        slug = candidate;
        break;
      }
      slug = `${candidate}-${randomUUID().slice(0, 8)}`;
    }

    const id = randomUUID();
    const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
    await db.run(
      `INSERT INTO content (id, site_id, type, title, slug, locale, translation_group_id, excerpt, blocks, fields, status, author_id, published_at, created_at, updated_at)
       VALUES (?, ?, 'page', ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?)`,
      [
        id,
        siteId,
        "Home",
        slug,
        locale,
        id,
        null,
        JSON.stringify(sanitizeBlockDocument(blocks)),
        JSON.stringify({}),
        session.userId,
        now,
        now,
        now,
      ],
    );

    await setHomePageId(siteId, id);
    const created = await db.query<Record<string, unknown>>(
      "SELECT * FROM content WHERE id = ? AND site_id = ? LIMIT 1",
      [id, siteId],
    );
    res.status(201).json({ ok: true, homePageId: id, page: serializeContentRow(created[0]!) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.post("/customize/promote-blog", requireRole(...THEME_CUSTOMIZE_ROLES), async (req, res) => {
  try {
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

    const session = req.session!;
    const blocks = await getEffectiveBlogBlocks(theme.theme_id, true);
    const locale = await getDefaultLocale();
    const db = await getDb();
    const candidates = ["blog", "news", "articles"];
    let slug = "blog";
    for (const candidate of candidates) {
      const existing = await db.query<{ id: string }>(
        "SELECT id FROM content WHERE site_id = ? AND type = 'page' AND slug = ? AND locale = ? LIMIT 1",
        [siteId, candidate, locale],
      );
      if (!existing[0]) {
        slug = candidate;
        break;
      }
      slug = `${candidate}-${randomUUID().slice(0, 8)}`;
    }

    const id = randomUUID();
    const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
    await db.run(
      `INSERT INTO content (id, site_id, type, title, slug, locale, translation_group_id, excerpt, blocks, fields, status, author_id, published_at, created_at, updated_at)
       VALUES (?, ?, 'page', ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?)`,
      [
        id,
        siteId,
        "Blog",
        slug,
        locale,
        id,
        null,
        JSON.stringify(sanitizeBlockDocument(blocks)),
        JSON.stringify({}),
        session.userId,
        now,
        now,
        now,
      ],
    );

    await setBlogPageId(siteId, id);
    const created = await db.query<Record<string, unknown>>(
      "SELECT * FROM content WHERE id = ? AND site_id = ? LIMIT 1",
      [id, siteId],
    );
    res.status(201).json({ ok: true, blogPageId: id, page: serializeContentRow(created[0]!) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
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
    await clearThemeBlogDraft(theme.theme_id);
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, "themes", err);
  }
});

export default router;
