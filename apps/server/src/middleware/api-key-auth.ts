// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from "express";
import { auditLog } from "../lib/security/audit-log.js";
import { clientIp } from "../lib/security/rate-limit.js";
import { logSafe } from "../lib/security/log-safe.js";
import {
  recordApiKeyUse,
  verifyApiKey,
  type ApiKeyOwner,
  type ApiKeyRecord,
} from "../lib/auth/api-keys.js";
import { isManageApiEnabled } from "../lib/http/manage-api-settings.js";
import { publicOrigin } from "../lib/ai/ai-settings.js";
import { ACCESS_TOKEN_PREFIX, verifyAccessToken } from "../lib/ai/oauth/oauth-store.js";
import { principalFromGrant } from "../lib/ai/tools/principal.js";
import { sessionMatchesRequestSite } from "../lib/tenancy/access.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKeyRecord;
      apiKeyOwner?: ApiKeyOwner;
    }
  }
}

/** One generic 401 for every failure — never disclose why. */
function deny(res: Response): void {
  res.status(401).json({ error: "Unauthorized" });
}

export function bearerToken(req: Request): string | null {
  const header = (req.get("authorization") ?? "").trim();
  // Match only the fixed "Bearer" prefix plus one whitespace char with the
  // regex, then take the remainder with plain string ops. `\s+` next to
  // `.+` (both of which match spaces) is ambiguous and lets an engine
  // backtrack quadratically over long runs of whitespace.
  const prefix = /^Bearer\s/i.exec(header);
  if (!prefix) return null;
  return header.slice(prefix[0].length).trim() || null;
}

export function ipAllowed(record: ApiKeyRecord, ip: string): boolean {
  if (record.allowedIps.length === 0) return true;
  return record.allowedIps.includes(ip);
}

export function originAllowed(record: ApiKeyRecord, origin: string | undefined): boolean {
  // A missing Origin header is a non-browser (server-to-server) client; the
  // per-key origin allowlist only constrains browsers.
  if (!origin) return true;
  if (record.allowedOrigins.length === 0) return true;
  return record.allowedOrigins.includes(origin);
}

async function auditFailure(req: Request, keyId: string | null): Promise<void> {
  try {
    const siteId = req.apiKeyOwner?.siteId ?? "";
    await auditLog({
      siteId,
      action: "apikey.auth_failed",
      outcome: "failure",
      target: keyId,
      ip: clientIp(req),
      userAgent: req.get("user-agent") ?? null,
      detail: `${req.method} ${String(req.path).replace(/[\r\n]/g, "")}`.slice(0, 200),
    });
  } catch {
    // Never let audit logging break the auth path.
  }
}

/**
 * Bearer-key authentication for `/api/manage/v1`.
 *
 * Resolves `Authorization: Bearer jfk_…` to a synthetic session
 * (`role: "api-key"`, the key owner's real `userId`/`siteId`) plus `req.apiKey`
 * / `req.apiKeyOwner` for capability checks. Enforces the global switch, the
 * key's revocation and expiry, and its IP / Origin allowlists — all per
 * request, so changes take effect without a restart. No CSRF: there is no
 * ambient credential to defend.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const token = bearerToken(req);
    if (!token) {
      await auditFailure(req, null);
      deny(res);
      return;
    }

    // An OAuth access token bound to this API (agent-facing use, #159) resolves
    // to the same synthetic session as a key: granted ∩ the user's current access.
    if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
      const grant = await verifyAccessToken(token, `${publicOrigin(req)}/api/manage/v1`).catch(() => null);
      if (!grant || !(await isManageApiEnabled())) {
        deny(res);
        return;
      }
      if (!sessionMatchesRequestSite(grant.grant.siteId)) {
        deny(res);
        return;
      }
      const principal = principalFromGrant(grant.grant, grant.role);
      req.apiKey = principal.key;
      req.apiKeyOwner = principal.owner;
      req.session = {
        userId: principal.owner.userId,
        siteId: principal.owner.siteId,
        role: "api-key",
        email: "",
        iat: Math.floor(Date.now() / 1000),
      };
      next();
      return;
    }

    let verified;
    try {
      verified = await verifyApiKey(token);
    } catch (err) {
      console.error("[justflows] api-key verification error", JSON.stringify(logSafe(String(err))));
      deny(res);
      return;
    }

    if (!verified) {
      await auditFailure(req, null);
      deny(res);
      return;
    }

    const { record, owner, rejection } = verified;
    req.apiKeyOwner = owner;

    if (rejection || !sessionMatchesRequestSite(owner.siteId) || !(await isManageApiEnabled())) {
      await auditFailure(req, record.id);
      deny(res);
      return;
    }

    const ip = clientIp(req);
    if (!ipAllowed(record, ip) || !originAllowed(record, req.get("origin") ?? undefined)) {
      await auditFailure(req, record.id);
      deny(res);
      return;
    }

    req.apiKey = record;
    req.session = {
      userId: owner.userId,
      siteId: owner.siteId,
      role: "api-key",
      email: "",
      iat: Math.floor(Date.now() / 1000),
    };
    await recordApiKeyUse(record.id, ip);
    next();
  })().catch(next);
}
