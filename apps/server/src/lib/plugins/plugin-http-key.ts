// SPDX-License-Identifier: MIT

import type { Request, Response } from "express";
import type { AccessScope, UserCapability } from "@justflows/sdk";
import {
  API_KEY_TOKEN_PREFIX,
  keyHolds,
  pluginCapabilityIds,
  recordApiKeyUse,
  verifyApiKey,
  type ApiKeyRecord,
} from "../auth/api-keys.js";
import { getEffectiveAccess } from "../auth/access-policy.js";
import { isManageApiEnabled } from "../http/manage-api-settings.js";
import { auditLog } from "../security/audit-log.js";
import { clientIp } from "../security/rate-limit.js";
import { logSafe } from "../security/log-safe.js";
import { sessionMatchesRequestSite } from "../tenancy/access.js";
import { bearerToken, ipAllowed, originAllowed } from "../../middleware/api-key-auth.js";
import { manageApiRateLimit } from "../../middleware/manage-api-rate-limit.js";

/**
 * Management API keys on plugin routes (`/ext/<plugin>/…`, `/api/shop/v1/…`).
 *
 * Plugin routes used to read only the session cookie, so a full-admin key that
 * drives core through MCP and `/api/manage/v1` could not reach a plugin's staff
 * API at all. A `Bearer jfk_…` key now resolves to the same identity those
 * surfaces use, with the same checks: the Manage API switch, revocation and
 * expiry, the key's site, its IP and Origin allowlists, and its rate limit.
 *
 * Capabilities are what the key holds (`keyHolds`: its own set, plus every
 * plugin capability when it has `site:admin`) ∩ the owner's current access.
 * A key with a scope is refused
 * here: plugin routes check capabilities, not scopes, so the scope could not
 * be enforced.
 *
 * Only `jfk_` tokens are handled. Any other Authorization value is ignored,
 * so the route behaves as for an anonymous visitor.
 */

export interface PluginKeySession {
  userId: string;
  siteId: string;
  role: "api-key";
  roles: string[];
  email: string;
  capabilities: UserCapability[];
  scopes: Partial<Record<UserCapability, AccessScope>>;
}

export type PluginKeyResult =
  | { kind: "none" }
  | { kind: "denied" }
  | { kind: "limited" }
  | { kind: "ok"; session: PluginKeySession };

function scoped(record: ApiKeyRecord): boolean {
  return Object.keys(record.scope ?? {}).length > 0;
}

async function auditFailure(req: Request, siteId: string, keyId: string | null): Promise<void> {
  if (!siteId) return;
  await auditLog({
    siteId,
    action: "apikey.auth_failed",
    outcome: "failure",
    target: keyId,
    ip: clientIp(req),
    userAgent: req.get("user-agent") ?? null,
    detail: `${req.method} ${String(req.path).replace(/[\r\n]/g, "")}`.slice(0, 200),
  }).catch(() => undefined);
}

/** Runs an Express limiter; false when it answered the request itself (429). */
function passes(handler: (req: Request, res: Response, next: (err?: unknown) => void) => unknown, req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const answered = () => resolve(false);
    res.once("finish", answered);
    res.once("close", answered);
    void Promise.resolve(
      handler(req, res, (err?: unknown) => {
        res.off("finish", answered);
        res.off("close", answered);
        if (err) reject(err);
        else resolve(true);
      }),
    ).catch(reject);
  });
}

export async function resolvePluginKeySession(req: Request, res: Response): Promise<PluginKeyResult> {
  const token = bearerToken(req);
  if (!token || !token.startsWith(API_KEY_TOKEN_PREFIX)) return { kind: "none" };

  let verified;
  try {
    verified = await verifyApiKey(token);
  } catch (err) {
    console.error("[justflows] plugin route key verification error", JSON.stringify(logSafe(String(err))));
    return { kind: "denied" };
  }
  if (!verified) return { kind: "denied" };

  const { record, owner, rejection } = verified;
  const ip = clientIp(req);
  if (
    rejection ||
    scoped(record) ||
    !sessionMatchesRequestSite(owner.siteId) ||
    !ipAllowed(record, ip) ||
    !originAllowed(record, req.get("origin") ?? undefined) ||
    !(await isManageApiEnabled())
  ) {
    await auditFailure(req, owner.siteId, record.id);
    return { kind: "denied" };
  }

  req.apiKey = record;
  req.apiKeyOwner = owner;
  for (const limiter of manageApiRateLimit) {
    if (!(await passes(limiter, req, res))) return { kind: "limited" };
  }

  const [access, plugin] = await Promise.all([getEffectiveAccess(owner.userId, owner.siteId, owner.role), pluginCapabilityIds()]);
  const capabilities = access.capabilities.filter((capability) => keyHolds(record, capability, plugin));

  await recordApiKeyUse(record.id, ip);
  return {
    kind: "ok",
    session: {
      userId: owner.userId,
      siteId: owner.siteId,
      role: "api-key",
      roles: ["api-key"],
      email: "",
      capabilities,
      scopes: access.policy.scopes ?? {},
    },
  };
}
