// SPDX-License-Identifier: MIT

import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requireCapability, requireInstallationRoot } from "../../middleware/auth.js";
import { isInstallationRootRequest } from "../../lib/tenancy/access.js";
import { auditFromRequest } from "../../lib/security/audit-log.js";
import { clientIp } from "../../lib/security/rate-limit.js";
import { sendServerError } from "../../lib/http/send-error.js";
import {
  CdnSettingsError,
  deleteCdnSettings,
  getCdnSettings,
  loadActiveCdn,
  loadSiteCdn,
  saveCdnSettings,
} from "../../lib/cdn/cdn-settings.js";
import { sitePurgeUrls } from "../../lib/cdn/cdn-purge.js";
import { CdnProviderError, isCdnProviderId, listCdnAdapters } from "../../lib/cdn/providers/index.js";
import { getTenantContext } from "../../lib/tenancy/context.js";

/**
 * Admin → Settings → CDN, mounted at `/api/cdn`. The connection is saved on
 * the platform site. A customer site may only purge its own hostnames.
 * Secret fields travel only from the browser to the server; responses carry
 * their last four characters, never the value.
 */
const router = Router();
router.use(requireCapability("settings:manage"));

const actionLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `cdn-action:${req.session?.userId ?? clientIp(req)}`,
});

function providerFailure(res: Response, err: CdnProviderError): void {
  res.status(502).json({ error: err.message });
}

function catalog() {
  return listCdnAdapters().map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    docsUrl: adapter.docsUrl,
    signupUrl: adapter.signupUrl ?? null,
    fields: adapter.fields.map(({ id, label, hint, secret, required, maxLength }) => ({
      id,
      label,
      hint: hint ?? null,
      secret,
      required,
      maxLength,
    })),
  }));
}

router.get("/", async (req, res) => {
  try {
    if (!isInstallationRootRequest()) {
      const active = await loadActiveCdn(req.session!.siteId);
      res.json({ managedOnPlatform: true, canPurge: Boolean(active) });
      return;
    }
    res.json({ managedOnPlatform: false, providers: catalog(), ...(await getCdnSettings(req.session!.siteId)) });
  } catch (err) {
    sendServerError(res, "cdn", err);
  }
});

const SaveSchema = z.object({
  provider: z.string().max(40),
  enabled: z.boolean().optional(),
  values: z.record(z.string().max(60), z.string().max(500).nullable()).default({}),
});

router.put("/", requireInstallationRoot, async (req, res) => {
  const body = SaveSchema.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid settings" });
  const { provider, enabled, values } = body.data;
  if (!isCdnProviderId(provider)) return void res.status(400).json({ error: "Unknown CDN provider" });
  try {
    const { connection, secretsReplaced } = await saveCdnSettings(req.session!.siteId, { provider, enabled, values });
    // Never a secret: the provider, the switch, and which secrets changed.
    auditFromRequest(req, "cdn.settings_saved", {
      target: provider,
      detail: [
        `enabled=${connection.enabled}`,
        ...secretsReplaced.map((id) => `${id} replaced (…${connection.secrets[id]?.last4 ?? ""})`),
      ].join(" "),
    });
    res.json({ connection });
  } catch (err) {
    if (err instanceof CdnSettingsError) return void res.status(400).json({ error: err.message });
    sendServerError(res, "cdn", err);
  }
});

router.delete("/", requireInstallationRoot, async (req, res) => {
  try {
    if (!(await deleteCdnSettings(req.session!.siteId))) return void res.status(404).json({ error: "Not found" });
    auditFromRequest(req, "cdn.settings_removed");
    res.status(204).end();
  } catch (err) {
    sendServerError(res, "cdn", err);
  }
});

/** Check the site's saved connection, on or off, against the provider. */
router.post("/test", requireInstallationRoot, actionLimit, async (req, res) => {
  try {
    const own = await loadSiteCdn(req.session!.siteId);
    if (!own) return void res.status(404).json({ error: "Save a CDN connection first." });
    await own.adapter.verify(own.config);
    res.json({ ok: true, provider: own.adapter.id });
  } catch (err) {
    if (err instanceof CdnProviderError) return providerFailure(res, err);
    sendServerError(res, "cdn", err);
  }
});

/** Purge this site's pages now, through the same CDN revalidation uses. */
router.post("/purge", actionLimit, async (req, res) => {
  const siteId = req.session!.siteId;
  try {
    const active = await loadActiveCdn(siteId);
    if (!active) return void res.status(404).json({ error: "No CDN is connected." });
    const urls = await sitePurgeUrls(siteId, getTenantContext()?.hostname ?? req.hostname);
    if (urls.length === 0) return void res.status(400).json({ error: "This site has no public hostname to purge." });
    await active.adapter.purgeUrls(active.config, urls);
    auditFromRequest(req, "cdn.purged", { target: active.adapter.id, detail: urls.join(" ") });
    res.json({ ok: true, provider: active.adapter.id, source: active.source, urls });
  } catch (err) {
    if (err instanceof CdnProviderError) return providerFailure(res, err);
    sendServerError(res, "cdn", err);
  }
});

export default router;
