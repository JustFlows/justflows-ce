// SPDX-License-Identifier: MIT

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { getControlDb } from "../../lib/database/db.js";
import { createWorkspace } from "../../lib/tenancy/provision.js";
import { isValidHostname, signupBaseDomain, signupSiteOrigin, slugify } from "../../lib/tenancy/host.js";
import { readSaasSettings, readSignupDatabaseTarget } from "../../lib/tenancy/saas-settings.js";
import { clientIp, consumeRateLimit, rateLimitRetryAfter } from "../../lib/security/rate-limit.js";

import { signupEmailAllowed } from "../../lib/security/signup-email-policy.js";
import { isInstallationRootRequest } from "../../lib/tenancy/access.js";
import { processFindSites } from "../../lib/tenancy/find-sites.js";

const router = Router();

const signupLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

router.post("/", signupLimit, async (req, res) => {
  const ip = clientIp(req);
  if (!consumeRateLimit(`signup:${ip}`, 5, 60 * 60 * 1000)) {
    res.setHeader("Retry-After", String(rateLimitRetryAfter(`signup:${ip}`)));
    res.status(429).json({ error: "Too many signup attempts. Try again later." });
    return;
  }
  const body = z.object({
    email: z.string().trim().toLowerCase().max(320).email(),
    password: z.string().min(12).max(1024),
    displayName: z.string().min(1).max(255),
    siteName: z.string().min(1).max(255),
    slug: z.string().min(1).max(60),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid signup" });
    return;
  }
  const db = await getControlDb();
  const rows = await db.query<{ value: unknown }>("SELECT value FROM platform_settings WHERE setting_key = 'saas' LIMIT 1");
  const settings = readSaasSettings(rows[0]?.value);
  if (!settings?.signupEnabled) {
    res.status(403).json({ error: "Public signup is turned off." });
    return;
  }
  if (!signupEmailAllowed(body.data.email, settings.signupEmailPolicy)) {
    res.status(403).json({ error: "This email address is not permitted for signup." });
    return;
  }
  const base = signupBaseDomain(settings.baseDomain) ?? "";
  if (!isValidHostname(base)) {
    res.status(503).json({ error: "The operator has not configured a signup domain." });
    return;
  }
  const slug = slugify(body.data.slug);
  const hostname = `${slug}.${base}`;
  if (!isValidHostname(hostname)) {
    res.status(400).json({ error: "That site address is not valid." });
    return;
  }
  const username = slug.replace(/-/g, "").slice(0, 30) || "owner";
  const origin = signupSiteOrigin(
    hostname,
    // req.protocol and req.host honour forwarded headers only from proxies
    // the deployment trusts (`trust proxy`), never from the visitor directly.
    req.protocol ?? "http",
    req.host ?? req.get("host") ?? "",
  );
  // Visitors never supply a database. The platform operator chooses, on
  // Platform → Public signup, whether new workspaces stay here or go to one
  // separate database. That connection stays on the platform.
  const signupDatabase = settings.signupDatabaseMode === "separate" ? readSignupDatabaseTarget(rows[0]?.value) : null;
  if (settings.signupDatabaseMode === "separate" && !signupDatabase) {
    res.status(503).json({ error: "The operator has not configured the signup database." });
    return;
  }
  const result = await createWorkspace({
    name: body.data.siteName,
    slug,
    userMode: "isolated",
    databaseMode: signupDatabase ? "separate" : "current",
    database: signupDatabase ?? undefined,
    siteName: body.data.siteName,
    hostname,
    siteUrl: origin,
    admin: {
      email: body.data.email,
      username,
      displayName: body.data.displayName,
      password: body.data.password,
    },
    actorId: null,
    platformOperator: false,
    requireNewOwner: true,
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(201).json({
    ok: true,
    hostname: result.hostname,
    url: origin,
    adminUrl: `${origin}/admin`,
  });
});

const FIND_SITES_WINDOW_MS = 15 * 60 * 1000;
const findSitesLimit = rateLimit({
  windowMs: FIND_SITES_WINDOW_MS,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

/**
 * Mail an owner the sites they own, for someone who forgot their site address.
 *
 * The answer is the same 202 whether or not the address owns sites, and the work
 * is not awaited, so the response neither lists nor confirms anything. Only the
 * address receives the list. The per-address limit applies to every address, so
 * a rate-limit answer does not disclose an account either.
 */
router.post("/find-sites", findSitesLimit, async (req, res) => {
  if (!isInstallationRootRequest()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const ip = clientIp(req);
  if (!consumeRateLimit(`findsites:ip:${ip}`, 60, FIND_SITES_WINDOW_MS)) {
    res.setHeader("Retry-After", String(rateLimitRetryAfter(`findsites:ip:${ip}`)));
    res.status(429).json({ error: "Too many requests. Try again later." });
    return;
  }
  const body = z.object({ email: z.string().trim().toLowerCase().max(320).email() }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Enter a valid email address" });
    return;
  }
  const email = body.data.email;
  /** Three an hour and five a day, so nobody can flood an owner's inbox. */
  for (const [key, max, windowMs] of [
    [`findsites:email:${email}`, 3, 60 * 60 * 1000],
    [`findsites:email-day:${email}`, 5, 24 * 60 * 60 * 1000],
  ] as const) {
    if (!consumeRateLimit(key, max, windowMs)) {
      res.setHeader("Retry-After", String(rateLimitRetryAfter(key)));
      res.status(429).json({ error: "Too many requests. Try again later." });
      return;
    }
  }
  /** The mailed link never comes from the request's Host header. */
  void processFindSites(email, {
    ip,
    userAgent: (req.get("user-agent") ?? "").slice(0, 255) || null,
    appUrl: process.env.APP_URL ?? "",
  });
  res.status(202).json({ ok: true });
});

export default router;
