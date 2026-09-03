// SPDX-License-Identifier: MIT

import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireRole } from "../middleware/auth.js";
import { sendServerError } from "../lib/send-error.js";
import {
  clearStaticExport,
  getStaticExportStatus,
  runStaticExport,
} from "../lib/static-export/index.js";
import {
  applyStaticExportSettings,
  readStaticExportSettings,
  StaticExportSettingsSchema,
} from "../lib/static-export/settings.js";

const router = Router();

/**
 * The crawl origin is normally resolved from the environment; the request-body
 * override exists only for dev / a hybrid proxy. Restrict it to loopback or an
 * origin the operator has already configured, so a compromised admin session
 * cannot turn the exporter into an SSRF probe / DoS cannon against arbitrary
 * hosts.
 */
function isAllowedCrawlBase(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  const norm = (v: string | undefined): string =>
    (v ?? "").trim().replace(/\/+$/, "").toLowerCase();
  const configured = new Set(
    [
      process.env.APP_URL,
      process.env.STATIC_EXPORT_BASE_URL,
      process.env.STATIC_EXPORT_CRAWL_URL,
      ...(process.env.STATIC_EXPORT_ALLOWED_ORIGINS ?? "").split(","),
    ]
      .map(norm)
      .filter(Boolean),
  );
  return configured.has(`${url.protocol}//${url.host}`.toLowerCase());
}

const runLimit = rateLimit({
  windowMs: 60_000,
  limit: 6,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many export runs — wait a minute and retry." },
});

router.use(requireRole("administrator"), (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

/** One export runs at a time per process — the crawl is I/O heavy. */
let inProgress: Promise<unknown> | null = null;

router.get("/status", async (_req, res) => {
  try {
    const status = await getStaticExportStatus();
    res.json({ ...status, running: inProgress != null });
  } catch (err) {
    sendServerError(res, "static-export", err);
  }
});

router.post("/run", runLimit, async (req, res) => {
  if (inProgress) {
    res.status(409).json({ ok: false, error: "An export is already running." });
    return;
  }

  const body = (req.body ?? {}) as { mode?: unknown; baseUrl?: unknown; publicUrl?: unknown };
  const mode = body.mode === "incremental" ? "incremental" : "full";
  const baseUrlRaw =
    typeof body.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl.trim() : "";
  if (baseUrlRaw && !isAllowedCrawlBase(baseUrlRaw)) {
    res.status(400).json({
      ok: false,
      error: "baseUrl must be loopback or an origin already configured for this site.",
    });
    return;
  }
  const baseUrl = baseUrlRaw || undefined;
  const publicUrl = typeof body.publicUrl === "string" ? body.publicUrl.trim() : undefined;
  if (publicUrl && !/^https?:\/\/[^\s"'<>`\\]+$/i.test(publicUrl)) {
    res.status(400).json({ ok: false, error: "publicUrl must be an http(s) URL." });
    return;
  }

  // Off production, crawl over loopback on the port this connection arrived on,
  // so a non-default dev port just works. On production the crawl origin is
  // resolved from STATIC_EXPORT_CRAWL_URL / APP_URL in getStaticExportConfig —
  // a raw 127.0.0.1:PORT is not this app behind a proxy (Passenger, Plesk).
  const isProd = process.env.NODE_ENV === "production";
  const localPort = req.socket.localPort;
  const resolvedBase =
    baseUrl ?? (!isProd && localPort ? `http://127.0.0.1:${localPort}` : undefined);

  const log: string[] = [];
  try {
    const run = runStaticExport({
      mode,
      baseUrl: resolvedBase,
      publicUrl,
      reason: "admin",
      log: (line) => log.push(line),
    });
    inProgress = run;
    const summary = await run;
    res.json({ ok: summary.ok, summary, log });
  } catch (err) {
    log.push(`✗ ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      log,
    });
  } finally {
    inProgress = null;
  }
});

/** Delete the whole export directory. */
router.post("/clear", runLimit, async (req, res) => {
  if (inProgress) {
    res.status(409).json({ ok: false, error: "An export is running — try again shortly." });
    return;
  }
  try {
    const force = (req.body as { force?: unknown })?.force === true;
    const result = await clearStaticExport({ force });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    sendServerError(res, "static-export", err);
  }
});

/** Read the editable STATIC_EXPORT_* settings (from .env, with live fallbacks). */
router.get("/settings", async (_req, res) => {
  try {
    res.json(await readStaticExportSettings());
  } catch (err) {
    sendServerError(res, "static-export", err);
  }
});

/** Persist the settings to .env and apply them without a restart. */
router.post("/settings", async (req, res) => {
  const parsed = StaticExportSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" });
    return;
  }
  try {
    res.json({ ok: true, ...(await applyStaticExportSettings(parsed.data)) });
  } catch (err) {
    sendServerError(res, "static-export", err);
  }
});

export default router;
