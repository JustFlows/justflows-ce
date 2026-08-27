import { Router } from "express";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { getSiteId, setSiteSetting, settingsKeyColumn } from "../lib/site-settings.js";
import { revalidateOnUpdate } from "../lib/cache-revalidate.js";
import { requireRole, requireSession } from "../middleware/auth.js";
import {
  formatPhpDate,
  isValidTimeZone,
  listTimeZones,
} from "../lib/datetime-format.js";
import { getGeneralSettings } from "../lib/general-settings.js";
import { getDefaultLocale, listLanguages, setDefaultLanguageByCode } from "../lib/i18n/languages-db.js";
import { THEME_CUSTOMIZE_ROLES, USER_ROLE_VALUES } from "../lib/rbac.js";
import { getHomePageId, setHomePageId } from "../lib/home-page.js";
import { getBlogPageId, setBlogPageId } from "../lib/blog-page.js";
import {
  getMailConfig,
  saveMailConfig,
  sendTestMail,
  toPublicMailSettings,
} from "../lib/mail.js";
import { sanitizeFaviconUrl } from "../lib/favicon.js";
import { SiteUrlSchema } from "../lib/site-url.js";
import { auditFromRequest } from "../lib/audit-log.js";
import { resolveFaviconUrl } from "../lib/theme-customize.js";
import { sendServerError } from "../lib/send-error.js";

const router = Router();

const Schema = z.object({
  site_name: z.string().min(1).optional(),
  site_description: z.string().optional(),
  site_url: SiteUrlSchema.optional(),
  posts_per_page: z.coerce.number().int().min(1).max(100).optional(),
  timezone: z.string().refine((tz) => isValidTimeZone(tz), "Invalid timezone").optional(),
  site_public: z.boolean().optional(),
  public_api_enabled: z.boolean().optional(),
  discourage_search_engines: z.boolean().optional(),
  admin_email: z.string().email().optional(),
  users_can_register: z.boolean().optional(),
  default_role: z.enum(USER_ROLE_VALUES).optional(),
  site_language: z.string().min(2).max(20).optional(),
  date_format: z.string().min(1).max(50).optional(),
  time_format: z.string().min(1).max(50).optional(),
  start_of_week: z.coerce.number().int().min(0).max(6).optional(),
  mail_transport: z.enum(["sendmail", "smtp"]).optional(),
  mail_from_name: z.string().max(120).optional(),
  smtp_host: z.string().max(255).optional(),
  smtp_port: z.coerce.number().int().min(1).max(65535).optional(),
  smtp_secure: z.enum(["none", "starttls", "ssl"]).optional(),
  smtp_user: z.string().max(320).optional(),
  smtp_pass: z.string().max(500).optional(),
  favicon_url: z.string().max(2048).optional(),
});

/**
 * Settings any signed-in user may read. Everything omitted here — the mail
 * transport, the admin address, and the registration policy — is administrator
 * only: a self-registered subscriber should not learn the SMTP host and
 * username, which are enough to start guessing at the mail account.
 */
const SESSION_READABLE_KEYS = new Set([
  "site_name",
  "site_description",
  "site_url",
  "posts_per_page",
  "timezone",
  "timezones",
  "utc_time",
  "local_time",
  "active_theme",
  "site_public",
  "site_language",
  "languages",
  "date_format",
  "time_format",
  "start_of_week",
  "favicon_url",
  "home_page_id",
  "blog_page_id",
]);

router.get("/", requireSession, async (req, res) => {
  const isAdmin = req.session?.role === "administrator";
  try {
    const db = await getDb();
    const settingsSiteId = await getSiteId();
    const siteRows = settingsSiteId
      ? await db.query<{ name: string; url: string; description: string | null }>(
          "SELECT name, url, description FROM sites WHERE id = ? LIMIT 1",
          [settingsSiteId],
        )
      : await db.query<{ name: string; url: string; description: string | null }>(
          "SELECT name, url, description FROM sites LIMIT 1",
        );
    const site = siteRows[0] ?? { name: "", url: "", description: "" };

    // Scoped, and no longer capped. The old LIMIT 100 had no ORDER BY either,
    // so once plugin settings pushed the table past a hundred rows the database
    // could drop `active_theme` from the result and the site would quietly fall
    // back to the default theme. Only the handful of keys read below are
    // returned to the caller, so the row count is not the thing to bound here.
    const settingRows = settingsSiteId
      ? await db.query<{ k: string; value: string }>(
          `SELECT ${settingsKeyColumn()} AS k, value FROM site_settings WHERE site_id = ?`,
          [settingsSiteId],
        )
      : await db.query<{ k: string; value: string }>(
          `SELECT ${settingsKeyColumn()} AS k, value FROM site_settings`,
        );
    const extras: Record<string, unknown> = {};
    for (const row of settingRows) {
      try {
        extras[row.k] = JSON.parse(row.value);
      } catch {
        extras[row.k] = row.value;
      }
    }

    const general = await getGeneralSettings();
    const mail = toPublicMailSettings(await getMailConfig());
    const languages = await listLanguages();
    const siteLanguage = await getDefaultLocale();
    const siteId = await getSiteId();
    const now = new Date();
    const timezone = general.timezone;

    const payload: Record<string, unknown> = {
      site_name: site.name,
      site_description: site.description ?? "",
      site_url: site.url,
      posts_per_page: extras["posts_per_page"] ?? 10,
      timezone,
      timezones: listTimeZones(),
      utc_time: formatPhpDate(now, "Y-m-d H:i:s", { timeZone: "UTC" }),
      local_time: formatPhpDate(now, "Y-m-d H:i:s", { timeZone: timezone }),
      active_theme: extras["active_theme"] ?? "justflows.default",
      site_public: extras["site_public"] === true,
      public_api_enabled:
        "public_api_enabled" in extras ? extras["public_api_enabled"] === true : false,
      discourage_search_engines:
        "discourage_search_engines" in extras ? extras["discourage_search_engines"] === true : true,
      admin_email: general.adminEmail,
      users_can_register: general.usersCanRegister,
      default_role: general.defaultRole,
      site_language: siteLanguage,
      languages: languages.map((l) => ({
        code: l.code,
        name: l.name,
        nativeName: l.nativeName,
        isDefault: l.isDefault,
        isActive: l.isActive,
      })),
      date_format: general.dateFormat,
      time_format: general.timeFormat,
      start_of_week: general.startOfWeek,
      mail_transport: mail.transport,
      mail_from_name: mail.fromName,
      smtp_host: mail.smtpHost,
      smtp_port: mail.smtpPort,
      smtp_secure: mail.smtpSecure,
      smtp_user: mail.smtpUser,
      smtp_pass_set: mail.smtpPassSet,
      favicon_url: await resolveFaviconUrl(),
      home_page_id: siteId ? await getHomePageId(siteId) : null,
      blog_page_id: siteId ? await getBlogPageId(siteId) : null,
    };

    if (isAdmin) {
      res.json(payload);
      return;
    }

    res.json(
      Object.fromEntries(Object.entries(payload).filter(([key]) => SESSION_READABLE_KEYS.has(key))),
    );
  } catch (e) {
    sendServerError(res, "settings", e);
  }
});

router.post("/", requireRole("administrator"), async (req, res) => {
  try {
    const body = Schema.parse(req.body);
    const db = await getDb();

    const siteUpdates: string[] = [];
    const siteParams: (string | number | boolean | null)[] = [];

    if (body.site_name !== undefined) {
      siteUpdates.push("name = ?");
      siteParams.push(body.site_name);
    }
    if (body.site_description !== undefined) {
      siteUpdates.push("description = ?");
      siteParams.push(body.site_description);
    }
    if (body.site_url !== undefined) {
      siteUpdates.push("url = ?");
      siteParams.push(body.site_url);
      process.env.APP_URL = body.site_url;
    }

    const siteId = await getSiteId();

    if (siteUpdates.length > 0) {
      if (!siteId) {
        res.status(503).json({ error: "No site found — complete install first" });
        return;
      }
      // Addressed by id. `UPDATE ... ORDER BY ... LIMIT` is a MySQL extension
      // and a syntax error on PostgreSQL, so this statement could never have
      // run on a postgres install.
      siteParams.push(siteId);
      await db.run(`UPDATE sites SET ${siteUpdates.join(", ")} WHERE id = ?`, siteParams);
    }
    const settingsToUpdate: [string, unknown][] = [];
    if (body.posts_per_page !== undefined) settingsToUpdate.push(["posts_per_page", body.posts_per_page]);
    if (body.timezone !== undefined) settingsToUpdate.push(["timezone", body.timezone]);
    if (body.site_public !== undefined) settingsToUpdate.push(["site_public", body.site_public]);
    if (body.public_api_enabled !== undefined) {
      settingsToUpdate.push(["public_api_enabled", body.public_api_enabled]);
    }
    if (body.discourage_search_engines !== undefined) {
      settingsToUpdate.push(["discourage_search_engines", body.discourage_search_engines]);
    }
    if (body.admin_email !== undefined) settingsToUpdate.push(["admin_email", body.admin_email]);
    if (body.users_can_register !== undefined) {
      settingsToUpdate.push(["users_can_register", body.users_can_register]);
    }
    if (body.default_role !== undefined) settingsToUpdate.push(["default_role", body.default_role]);
    if (body.date_format !== undefined) settingsToUpdate.push(["date_format", body.date_format]);
    if (body.time_format !== undefined) settingsToUpdate.push(["time_format", body.time_format]);
    if (body.start_of_week !== undefined) settingsToUpdate.push(["start_of_week", body.start_of_week]);
    if (body.favicon_url !== undefined) {
      settingsToUpdate.push(["favicon_url", sanitizeFaviconUrl(body.favicon_url)]);
    }

    const mailPatch = {
      ...(body.mail_transport !== undefined ? { transport: body.mail_transport } : {}),
      ...(body.mail_from_name !== undefined ? { fromName: body.mail_from_name } : {}),
      ...(body.smtp_host !== undefined ? { smtpHost: body.smtp_host } : {}),
      ...(body.smtp_port !== undefined ? { smtpPort: body.smtp_port } : {}),
      ...(body.smtp_secure !== undefined ? { smtpSecure: body.smtp_secure } : {}),
      ...(body.smtp_user !== undefined ? { smtpUser: body.smtp_user } : {}),
      ...(body.smtp_pass !== undefined ? { smtpPass: body.smtp_pass } : {}),
    };
    const mailTouched = Object.keys(mailPatch).length > 0;

    // setSiteSetting already branches on the driver. The old else-branch here
    // was raw MySQL — UUID(), NOW() and ON DUPLICATE KEY — and would have
    // thrown on PostgreSQL for a site that has no id, which is a state this
    // handler now rejects outright above.
    if (!siteId && settingsToUpdate.length > 0) {
      res.status(503).json({ error: "No site found — complete install first" });
      return;
    }
    for (const [key, value] of settingsToUpdate) {
      await setSiteSetting(siteId!, key, value);
    }

    // Keys, never values: a settings write can carry an SMTP password.
    const changedKeys = settingsToUpdate.map(([k]) => k);
    if (changedKeys.length > 0 || siteUpdates.length > 0) {
      auditFromRequest(req, "settings.changed", {
        detail: [...changedKeys, ...(siteUpdates.length ? ["site"] : [])].join(", "),
      });
    }
    // Called out separately because it moves the whole public API surface
    // between reachable and 404.
    if (body.public_api_enabled !== undefined) {
      auditFromRequest(req, "public_api.toggled", {
        detail: body.public_api_enabled ? "enabled" : "disabled",
      });
    }

    if (mailTouched && siteId) {
      await saveMailConfig(siteId, mailPatch);
    }

    if (body.site_language !== undefined && siteId) {
      await setDefaultLanguageByCode(siteId, body.site_language);
    }

    await revalidateOnUpdate("settings");

    if (siteId && (body.site_name !== undefined || body.site_description !== undefined)) {
      const { getActiveTheme } = await import("../lib/themes-db.js");
      const { getThemeMods, saveThemeMods } = await import("../lib/theme-customize.js");
      const theme = await getActiveTheme(siteId);
      if (theme) {
        const published = (await getThemeMods(theme.theme_id, false)) ?? {};
        await saveThemeMods(theme.theme_id, published, false);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: e.issues[0]?.message ?? "Invalid settings" });
      return;
    }
    sendServerError(res, "settings", e);
  }
});

const HomePageSchema = z.object({
  contentId: z.string().uuid().nullable(),
});

router.put("/home-page", requireRole(...THEME_CUSTOMIZE_ROLES), async (req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found" });
      return;
    }
    const body = HomePageSchema.parse(req.body);
    const homePageId = await setHomePageId(siteId, body.contentId);
    res.json({ ok: true, homePageId });
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: e.issues[0]?.message ?? "Invalid home page" });
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    const status = message === "Page not found" || message === "Home must be a page" ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

const BlogPageSchema = z.object({
  contentId: z.string().uuid().nullable(),
});

router.put("/blog-page", requireRole(...THEME_CUSTOMIZE_ROLES), async (req, res) => {
  try {
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(503).json({ error: "No site found" });
      return;
    }
    const body = BlogPageSchema.parse(req.body);
    const blogPageId = await setBlogPageId(siteId, body.contentId);
    res.json({ ok: true, blogPageId });
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: e.issues[0]?.message ?? "Invalid blog page" });
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    const status = message === "Page not found" || message === "Blog page must be a page" ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

router.post("/test-mail", requireRole("administrator"), async (_req, res) => {
  try {
    const result = await sendTestMail();
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    sendServerError(res, "settings", e);
  }
});

export default router;
