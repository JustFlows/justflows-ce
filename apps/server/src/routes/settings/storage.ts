// SPDX-License-Identifier: MIT

import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requireCapability } from "../../middleware/auth.js";
import { getDb } from "../../lib/database/db.js";
import { runPrivateFilesCopy } from "../../lib/files/private-files-job.js";
import {
  activePrivateBackend,
  clearPrivateStorage,
  describeActivePrivateStorage,
  getPrivateStorageSettings,
  PrivateStorageError,
  savePrivateStorage,
  testPrivateStorage,
  type SavePrivateStorageInput,
} from "../../lib/files/private-storage.js";
import { auditFromRequest } from "../../lib/security/audit-log.js";
import { clientIp } from "../../lib/security/rate-limit.js";
import { sendServerError } from "../../lib/http/send-error.js";
import { isInstallationRootRequest } from "../../lib/tenancy/access.js";
import { checkQuota } from "../../lib/tenancy/quotas.js";

/**
 * Admin → Settings → Storage, mounted at `/api/storage`: where this site keeps
 * private files (downloads and other files plugins never make public).
 *
 * The root site's connection is the default for every site. Another site may
 * save its own when its plan allows `feature.ownStorage`. Keys travel only from
 * the browser to the server; answers carry their last four characters. Saving
 * or removing a connection starts copying existing files to the new storage.
 */
const router = Router();
router.use(requireCapability("settings:manage"));
// A website whose plan has no own storage has no Storage page at all; the root site always does.
router.use((req, res, next) => {
  void ownStorageAllowed(req.session!.siteId)
    .then((allowed) => (allowed ? next() : void res.status(403).json({ error: "This site uses the platform's storage.", code: "feature_disabled", meter: "feature.ownStorage" })))
    .catch(next);
});

const testLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `storage-test:${req.session?.userId ?? clientIp(req)}`,
});

const ConnectionSchema = z.object({
  endpoint: z.string().max(300).optional(),
  region: z.string().max(40).optional(),
  bucket: z.string().min(1).max(63),
  prefix: z.string().max(120).optional(),
  forcePathStyle: z.boolean().optional(),
  accessKeyId: z.string().max(200).optional(),
  secretAccessKey: z.string().max(300).optional(),
});

async function ownStorageAllowed(siteId: string): Promise<boolean> {
  if (isInstallationRootRequest()) return true;
  try {
    return (await checkQuota("feature.ownStorage", siteId, { delta: 0 })).ok;
  } catch {
    return false;
  }
}

async function usage(siteId: string, key: "files.count" | "files.bytes") {
  try {
    const decision = await checkQuota(key, siteId, { delta: 0 });
    return { used: decision.used, limit: decision.limit };
  } catch {
    return { used: null, limit: null };
  }
}

async function overview(siteId: string) {
  const active = await activePrivateBackend(siteId);
  const db = await getDb();
  const waiting = await db.query<{ total: number | string }>(
    "SELECT COUNT(*) AS total FROM private_files WHERE site_id = ? AND storage_id <> ?",
    [siteId, active.id],
  );
  return {
    root: isInstallationRootRequest(),
    ownStorageAllowed: await ownStorageAllowed(siteId),
    ...(await describeActivePrivateStorage(siteId)),
    ...(await getPrivateStorageSettings(siteId)),
    copying: Number(waiting[0]?.total ?? 0) || 0,
    files: await usage(siteId, "files.count"),
    bytes: await usage(siteId, "files.bytes"),
  };
}

router.get("/", async (req, res) => {
  try {
    res.json(await overview(req.session!.siteId));
  } catch (err) {
    sendServerError(res, "storage", err);
  }
});

function input(body: z.infer<typeof ConnectionSchema>): SavePrivateStorageInput {
  return {
    bucket: body.bucket,
    ...(body.endpoint !== undefined ? { endpoint: body.endpoint } : {}),
    ...(body.region !== undefined ? { region: body.region } : {}),
    ...(body.prefix !== undefined ? { prefix: body.prefix } : {}),
    ...(body.forcePathStyle !== undefined ? { forcePathStyle: body.forcePathStyle } : {}),
    ...(body.accessKeyId ? { accessKeyId: body.accessKeyId } : {}),
    ...(body.secretAccessKey ? { secretAccessKey: body.secretAccessKey } : {}),
  };
}

router.post("/test", testLimit, async (req, res) => {
  const siteId = req.session!.siteId;
  if (!(await ownStorageAllowed(siteId))) return void res.status(403).json({ error: "This site uses the platform's storage." });
  const body = ConnectionSchema.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid connection" });
  try {
    await testPrivateStorage(siteId, input(body.data));
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof PrivateStorageError) return void res.status(400).json({ error: err.message });
    sendServerError(res, "storage", err);
  }
});

router.put("/", async (req, res) => {
  const siteId = req.session!.siteId;
  if (!(await ownStorageAllowed(siteId))) return void res.status(403).json({ error: "This site uses the platform's storage." });
  const body = ConnectionSchema.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid connection" });
  try {
    // Check before switching, so files are never sent to a bucket that refuses them.
    await testPrivateStorage(siteId, input(body.data));
    const saved = await savePrivateStorage(siteId, input(body.data));
    auditFromRequest(req, "storage.saved", {
      target: saved.connection?.bucket ?? "",
      detail: `endpoint=${saved.connection?.endpoint || "aws"} key=…${saved.connection?.accessKeyId.last4 ?? ""}`,
    });
    void runPrivateFilesCopy();
    res.json(await overview(siteId));
  } catch (err) {
    if (err instanceof PrivateStorageError) return void res.status(400).json({ error: err.message });
    sendServerError(res, "storage", err);
  }
});

router.delete("/", async (req, res) => {
  const siteId = req.session!.siteId;
  try {
    await clearPrivateStorage(siteId);
    auditFromRequest(req, "storage.removed");
    void runPrivateFilesCopy();
    res.json(await overview(siteId));
  } catch (err) {
    sendServerError(res, "storage", err);
  }
});

export default router;
