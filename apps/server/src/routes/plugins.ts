import { Router } from "express";
import { requireRole, requireSession } from "../middleware/auth.js";
import { param } from "../lib/params.js";
import {
  activatePlugin,
  deactivatePlugin,
  deletePlugin,
  getPlugin,
  insertPlugin,
  listPlugins,
  pluginToDto,
} from "../lib/plugins-db.js";
import multer from "multer";
import { assertPackageIsTrusted } from "../lib/package-trust.js";
import { packagesInstalledDir } from "../lib/packages-dir.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// The installed extension set and its versions fingerprint the site.
router.get("/", requireRole("administrator", "editor"), async (req, res) => {
  const session = req.session!;

  try {
    const plugins = await listPlugins(session.siteId);
    res.json({ plugins });
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
    if (file.size > 50 * 1024 * 1024) {
      res.status(413).json({ error: "File too large (max 50 MB)" });
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

    if (result.manifest.type !== "plugin") {
      res.status(400).json({ error: "Uploaded package is not a plugin (manifest.type must be 'plugin')" });
      return;
    }

    assertPackageIsTrusted(result.manifest as unknown as Record<string, unknown>, result.digest);

    const siteId = req.session?.siteId;
    if (!siteId) {
      res.status(503).json({ error: "No site found — complete install first" });
      return;
    }

    const plugin = await insertPlugin(siteId, {
      pluginId: result.manifest.id,
      version: result.manifest.version,
      manifest: {
        ...result.manifest,
        installedPath: result.installedPath,
      },
      status: "installed",
    });

    res.json({ plugin });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/:id/activate", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const pluginId = param(req.params.id);
  const { runtimeActivatePlugin } = await import("../lib/plugin-runtime.js");
  await activatePlugin(session.siteId, pluginId);
  await runtimeActivatePlugin(session.siteId, pluginId).catch(() => null);
  const { revalidateOnUpdate } = await import("../lib/cache-revalidate.js");
  await revalidateOnUpdate("plugin");
  res.json({ ok: true });
});

router.post("/:id/deactivate", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const pluginId = param(req.params.id);
  const { runtimeDeactivatePlugin } = await import("../lib/plugin-runtime.js");
  await deactivatePlugin(session.siteId, pluginId);
  await runtimeDeactivatePlugin(session.siteId, pluginId).catch(() => null);
  res.json({ ok: true });
});

router.delete("/:id", requireRole("administrator"), async (req, res) => {
  const session = req.session!;
  const pluginId = param(req.params.id);
  await deletePlugin(session.siteId, pluginId);
  res.json({ ok: true });
});

// Registered ahead of "/:id" so the literal path is not swallowed by the param.
router.get("/admin-menu", requireSession, async (req, res) => {
  try {
    const { listPluginAdminMenu } = await import("../lib/admin-menu.js");
    res.json({ items: await listPluginAdminMenu(req.session!.siteId) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/:id", requireRole("administrator", "editor"), async (req, res) => {
  const plugin = await getPlugin(req.session!.siteId, param(req.params.id));
  if (!plugin) {
    res.status(404).json({ error: "Plugin not found" });
    return;
  }
  res.json({ plugin: pluginToDto(plugin) });
});

router.get("/:id/settings", requireRole("administrator"), async (req, res) => {
  const pluginId = param(req.params.id);
  const plugin = await getPlugin(req.session!.siteId, pluginId);
  if (!plugin) {
    res.status(404).json({ error: "Plugin not found" });
    return;
  }
  const { getSiteSetting } = await import("../lib/site-settings.js");
  const { listLanguages, getDefaultLocale } = await import("../lib/i18n/languages-db.js");
  const { asLocaleMap } = await import("../lib/seo-public.js");
  const schema = pluginToDto(plugin).settingsSchema ?? {};
  const languages = await listLanguages(req.session!.siteId, true);
  const defaultLocale = await getDefaultLocale(req.session!.siteId);
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(schema)) {
    const raw = (await getSiteSetting(req.session!.siteId, `plugin.${pluginId}:${key}`)) ?? schema[key]?.default;
    values[key] = schema[key]?.localized ? asLocaleMap(raw, defaultLocale) : raw;
  }

  if (pluginId === "justflows.seo") {
    const db = await import("../lib/db.js").then((m) => m.getDb());
    const siteRows = await db.query<{ name: string; description: string | null }>(
      "SELECT name, description FROM sites WHERE id = ? LIMIT 1",
      [req.session!.siteId],
    );
    const site = siteRows[0];
    const titles = (values.siteTitle ?? {}) as Record<string, string>;
    const descriptions = (values.defaultDescription ?? {}) as Record<string, string>;
    if (site?.name && !titles[defaultLocale]) titles[defaultLocale] = site.name;
    if (site?.description && !descriptions[defaultLocale]) descriptions[defaultLocale] = site.description;
    values.siteTitle = titles;
    values.defaultDescription = descriptions;
  }

  if (pluginId === "justflows.analytics") {
    const { parseGoogleTagId } = await import("../lib/google-tag.js");
    const parsed = parseGoogleTagId(String(values.googleTagId ?? ""));
    values.googleTagId = parsed ?? "";
  }

  res.json({ schema, values, languages });
});

router.put("/:id/settings", requireRole("administrator"), async (req, res) => {
  const pluginId = param(req.params.id);
  const plugin = await getPlugin(req.session!.siteId, pluginId);
  if (!plugin) {
    res.status(404).json({ error: "Plugin not found" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { setSiteSetting } = await import("../lib/site-settings.js");
  const schema = pluginToDto(plugin).settingsSchema ?? {};
  for (const key of Object.keys(schema)) {
    if (!(key in body)) continue;
    if (pluginId === "justflows.analytics" && key === "googleTagId") {
      const { parseGoogleTagId } = await import("../lib/google-tag.js");
      const raw = String(body[key] ?? "").trim();
      if (!raw) {
        await setSiteSetting(req.session!.siteId, `plugin.${pluginId}:${key}`, "");
        continue;
      }
      const parsed = parseGoogleTagId(raw);
      if (!parsed) {
        res.status(400).json({ error: "Enter a Google tag ID such as G-XXXXXXXX or GTM-XXXXXXX." });
        return;
      }
      await setSiteSetting(req.session!.siteId, `plugin.${pluginId}:${key}`, parsed);
      continue;
    }
    await setSiteSetting(req.session!.siteId, `plugin.${pluginId}:${key}`, body[key]);
  }
  const { clearGoogleTagIdCache } = await import("../lib/analytics-public.js");
  clearGoogleTagIdCache();
  const { revalidateOnUpdate } = await import("../lib/cache-revalidate.js");
  await revalidateOnUpdate("plugin");
  res.json({ ok: true });
});

router.get("/:id/data/:collection", requireRole("administrator"), async (req, res) => {
  const pluginId = param(req.params.id);
  const collection = param(req.params.collection);
  const { createPluginDataApi } = await import("../lib/plugin-data.js");
  const store = createPluginDataApi(pluginId, req.session!.siteId);
  res.json({ items: await store.list(collection) });
});

export default router;
