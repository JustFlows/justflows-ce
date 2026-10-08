// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { getControlDb } from "../../lib/database/db.js";
import { requireSession } from "../../middleware/auth.js";
import { isPlatformOperator } from "../../lib/tenancy/access.js";
import { clientIp } from "../../lib/security/rate-limit.js";
import { sendServerError } from "../../lib/http/send-error.js";
import {
  buildDomainSettings,
  publicDomainSettings,
  readDomainSettings,
  writeDomainSettings,
} from "../../lib/domains/domain-settings.js";
import { BUNNY_NAMESERVERS, BUNNY_NAMESERVER_IPS } from "../../lib/domains/providers/bunny.js";
import { DomainProviderError, domainProviderFor } from "../../lib/domains/providers/index.js";

/**
 * Platform → Custom domains, mounted at `/api/platform/custom-domains`.
 * Platform operators only. The Bunny API key is write-only.
 */
const router = Router();

router.use(requireSession, (req, res, next) => {
  void isPlatformOperator(req.session!.userId)
    .then((operator) => {
      if (!operator)
        return void res.status(403).json({ error: "Platform operator access is required" });
      next();
    })
    .catch(next);
});

const testLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `domain-settings-test:${req.session?.userId ?? clientIp(req)}`,
});

function overview(settings: Awaited<ReturnType<typeof readDomainSettings>>) {
  return {
    settings: publicDomainSettings(settings),
    providerNameservers: [...BUNNY_NAMESERVERS],
    nameserverAddresses: BUNNY_NAMESERVER_IPS.map((entry) => ({ ...entry })),
  };
}

router.get("/", async (_req, res) => {
  try {
    res.json(overview(await readDomainSettings()));
  } catch (err) {
    sendServerError(res, "custom-domains", err);
  }
});

const SettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.string().max(20),
  modes: z.object({ records: z.boolean().optional(), nameservers: z.boolean().optional() }),
  cnameTarget: z.string().max(253),
  apexAddresses: z.array(z.string().max(45)).max(8),
  nameservers: z.array(z.string().max(253)).max(4),
  soaEmail: z.string().max(254),
  includeWww: z.boolean(),
  redirectToPrimary: z.boolean(),
  pendingExpiryDays: z.number().int().min(1).max(90),
  failureThreshold: z.number().int().min(1).max(50),
  upgradeUrl: z.string().max(500),
  bunny: z.object({
    pullZoneId: z.string().max(20),
    apiKey: z.string().max(200).nullable().optional(),
  }),
});

router.put("/", async (req, res) => {
  const body = SettingsSchema.safeParse(req.body);
  if (!body.success)
    return void res
      .status(400)
      .json({ error: body.error.issues[0]?.message ?? "Invalid settings" });
  try {
    const built = buildDomainSettings(await readDomainSettings(), body.data);
    if (!built.ok) return void res.status(400).json({ error: built.error });
    await writeDomainSettings(built.stored);
    const db = await getControlDb();
    const uuid = /^[0-9a-f-]{36}$/i.test(req.session!.userId) ? req.session!.userId : null;
    await db.run(
      "INSERT INTO platform_audit (id, actor_id, action, target, detail, created_at) VALUES (?, ?, 'domains.settings_saved', ?, ?, ?)",
      [
        randomUUID(),
        uuid,
        built.stored.provider,
        `enabled=${built.stored.enabled} records=${built.stored.modes.records} nameservers=${built.stored.modes.nameservers}${body.data.bunny.apiKey ? " apiKey=replaced" : ""}`,
        new Date()
          .toISOString()
          .replace("T", " ")
          .replace(/\.\d+Z$/, ""),
      ],
    );
    res.json(overview(built.stored));
  } catch (err) {
    sendServerError(res, "custom-domains", err);
  }
});

/** Check the saved provider connection. For Bunny, also returns the pull zone's own hostname. */
router.post("/test", testLimit, async (_req, res) => {
  try {
    const provider = await domainProviderFor(await readDomainSettings());
    const result = await provider.verify();
    res.json({ ok: true, provider: provider.id, cnameTarget: result.cnameTarget });
  } catch (err) {
    if (err instanceof DomainProviderError)
      return void res.status(502).json({ error: err.message });
    sendServerError(res, "custom-domains", err);
  }
});

export default router;
