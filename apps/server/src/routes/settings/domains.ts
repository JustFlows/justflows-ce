// SPDX-License-Identifier: MIT

import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requireCapability } from "../../middleware/auth.js";
import { auditFromRequest } from "../../lib/security/audit-log.js";
import { clientIp } from "../../lib/security/rate-limit.js";
import { sendServerError } from "../../lib/http/send-error.js";
import {
  addCustomDomain,
  addZoneRecord,
  checkCustomDomain,
  deleteZoneRecord,
  domainAccess,
  listSiteDomains,
  listZoneRecords,
  removeCustomDomain,
  setPrimaryDomain,
  tlsAllowed,
  type DomainResult,
} from "../../lib/domains/custom-domains.js";

/**
 * Admin → Settings → Domains, mounted at `/api/domains`. A website connects
 * hostnames it owns. What it may do is decided by the platform settings and
 * the site's `feature.customDomains`, `domains.custom`, and
 * `feature.managedDns` limits.
 */
const router = Router();

const tlsLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `domain-tls:${clientIp(req)}`,
});

/**
 * Reverse proxy question before it issues a certificate, such as Caddy's
 * `on_demand_tls { ask … }`. 200 when the hostname is a verified domain on
 * this installation, 404 otherwise. Needs no session.
 */
router.get("/tls-allowed", tlsLimit, async (req, res) => {
  const domain = typeof req.query.domain === "string" ? req.query.domain : "";
  try {
    res.status((await tlsAllowed(domain)) ? 200 : 404).end();
  } catch (err) {
    sendServerError(res, "domains", err);
  }
});

router.use(requireCapability("settings:manage"));

const actionLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `domain-action:${req.session?.userId ?? clientIp(req)}`,
});

function reply<T>(res: Response, result: DomainResult<T>, key: "domains" | "records"): boolean {
  if (!result.ok) {
    res
      .status(result.status)
      .json({ error: result.error, ...(result.code ? { code: result.code } : {}) });
    return false;
  }
  res.json({ [key]: result.value });
  return true;
}

router.get("/", async (req, res) => {
  const siteId = req.session!.siteId;
  try {
    res.json({ access: await domainAccess(siteId), domains: await listSiteDomains(siteId) });
  } catch (err) {
    sendServerError(res, "domains", err);
  }
});

const AddSchema = z.object({
  hostname: z.string().min(1).max(260),
  mode: z.enum(["records", "nameservers"]),
});

router.post("/", actionLimit, async (req, res) => {
  const body = AddSchema.safeParse(req.body);
  if (!body.success)
    return void res.status(400).json({ error: "Enter a domain and how to connect it." });
  try {
    const result = await addCustomDomain(req.session!.siteId, body.data);
    if (reply(res, result, "domains")) {
      auditFromRequest(req, "domain.added", {
        target: body.data.hostname.slice(0, 253),
        detail: `mode=${body.data.mode}`,
      });
    }
  } catch (err) {
    sendServerError(res, "domains", err);
  }
});

router.post("/:id/check", actionLimit, async (req, res) => {
  try {
    reply(res, await checkCustomDomain(req.session!.siteId, String(req.params.id)), "domains");
  } catch (err) {
    sendServerError(res, "domains", err);
  }
});

router.post("/:id/primary", actionLimit, async (req, res) => {
  try {
    const result = await setPrimaryDomain(req.session!.siteId, String(req.params.id));
    if (reply(res, result, "domains")) {
      const primary = result.ok
        ? result.value.find((domain) => domain.isPrimary)?.hostname
        : undefined;
      auditFromRequest(req, "domain.primary_changed", { target: primary });
    }
  } catch (err) {
    sendServerError(res, "domains", err);
  }
});

router.delete("/:id", actionLimit, async (req, res) => {
  const siteId = req.session!.siteId;
  try {
    const before = (await listSiteDomains(siteId)).find((domain) => domain.id === req.params.id);
    if (reply(res, await removeCustomDomain(siteId, String(req.params.id)), "domains")) {
      auditFromRequest(req, "domain.removed", { target: before?.hostname });
    }
  } catch (err) {
    sendServerError(res, "domains", err);
  }
});

router.get("/:id/records", async (req, res) => {
  try {
    reply(res, await listZoneRecords(req.session!.siteId, String(req.params.id)), "records");
  } catch (err) {
    sendServerError(res, "domains", err);
  }
});

const RecordSchema = z.object({
  type: z.string().max(10),
  name: z.string().max(253),
  value: z.string().max(2000),
  ttl: z.number().int().optional(),
  priority: z.number().int().nullable().optional(),
});

router.post("/:id/records", actionLimit, async (req, res) => {
  const body = RecordSchema.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "The record is not valid." });
  try {
    if (
      reply(
        res,
        await addZoneRecord(req.session!.siteId, String(req.params.id), body.data),
        "records",
      )
    ) {
      auditFromRequest(req, "domain.dns_record_added", {
        target: `${body.data.type} ${body.data.name || "@"}`.slice(0, 255),
      });
    }
  } catch (err) {
    sendServerError(res, "domains", err);
  }
});

router.delete("/:id/records/:recordId", actionLimit, async (req, res) => {
  const recordId = String(req.params.recordId);
  if (!/^\d{1,20}$/.test(recordId))
    return void res.status(404).json({ error: "That record was not found." });
  try {
    if (
      reply(
        res,
        await deleteZoneRecord(req.session!.siteId, String(req.params.id), recordId),
        "records",
      )
    ) {
      auditFromRequest(req, "domain.dns_record_removed", { target: recordId });
    }
  } catch (err) {
    sendServerError(res, "domains", err);
  }
});

export default router;
