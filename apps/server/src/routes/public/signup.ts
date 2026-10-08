// SPDX-License-Identifier: MIT

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { getControlDb } from "../../lib/database/db.js";
import { createWorkspace } from "../../lib/tenancy/provision.js";
import { isValidHostname, signupBaseDomain, signupSiteOrigin, slugify } from "../../lib/tenancy/host.js";
import { readSaasSettings, readSignupDatabaseTarget } from "../../lib/tenancy/saas-settings.js";
import { clientIp, consumeRateLimit, rateLimitRetryAfter } from "../../lib/security/rate-limit.js";

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
    email: z.string().email(),
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

export default router;
