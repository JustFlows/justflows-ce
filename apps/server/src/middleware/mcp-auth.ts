// SPDX-License-Identifier: MIT

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { recordApiKeyUse, verifyApiKey } from "../lib/auth/api-keys.js";
import { auditLog } from "../lib/security/audit-log.js";
import { clientIp } from "../lib/security/rate-limit.js";
import { logSafe } from "../lib/security/log-safe.js";
import { getMcpRateLimit, isMcpEnabled, mcpResourceUrl, publicOrigin } from "../lib/ai/ai-settings.js";
import { ACCESS_TOKEN_PREFIX, verifyAccessToken } from "../lib/ai/oauth/oauth-store.js";
import { principalFromApiKey, principalFromGrant, type AgentPrincipal } from "../lib/ai/tools/principal.js";
import { sessionMatchesRequestSite } from "../lib/tenancy/access.js";
import { bearerToken, ipAllowed, originAllowed } from "./api-key-auth.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      agentPrincipal?: AgentPrincipal;
    }
  }
}

/**
 * Authentication for `/api/mcp`.
 *
 * Accepts either a management API key (`jfk_…`, for clients that send custom
 * headers: Cursor, Claude Code, Claude Desktop, VS Code) or an OAuth access
 * token (`jfo_at_…`, for hosted connectors: claude.ai, ChatGPT) bound to this
 * MCP resource. Every failure is the same 401 with the `WWW-Authenticate`
 * challenge the MCP authorization spec requires, pointing at the protected
 * resource metadata — it never says whether a key, token or client exists.
 */

export function protectedResourceMetadataUrl(req: Request): string {
  return `${publicOrigin(req)}/.well-known/oauth-protected-resource/api/mcp`;
}

function challenge(req: Request, res: Response, invalidToken: boolean): void {
  const params = [`resource_metadata="${protectedResourceMetadataUrl(req)}"`];
  if (invalidToken) params.unshift('error="invalid_token"');
  res.setHeader("WWW-Authenticate", `Bearer ${params.join(", ")}`);
  res.status(401).json({ error: "Unauthorized" });
}

async function auditFailure(req: Request, siteId: string, target: string | null): Promise<void> {
  if (!siteId) return;
  await auditLog({
    siteId,
    action: "mcp.auth_failed",
    outcome: "failure",
    target,
    ip: clientIp(req),
    userAgent: req.get("user-agent") ?? null,
  }).catch(() => undefined);
}

/** The switch: MCP answers 404 while it (or the management API) is off. */
export function mcpEnabledGuard(_req: Request, res: Response, next: NextFunction): void {
  isMcpEnabled()
    .then((enabled) => {
      if (!enabled) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      next();
    })
    .catch(next);
}

export function mcpAuth(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const token = bearerToken(req);
    if (!token) {
      challenge(req, res, false);
      return;
    }

    if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
      const verified = await verifyAccessToken(token, mcpResourceUrl(req));
      if (!verified) {
        challenge(req, res, true);
        return;
      }
      if (!sessionMatchesRequestSite(verified.grant.siteId)) {
        await auditFailure(req, verified.grant.siteId, verified.grant.id);
        challenge(req, res, true);
        return;
      }
      req.agentPrincipal = principalFromGrant(verified.grant, verified.role);
      next();
      return;
    }

    let verified;
    try {
      verified = await verifyApiKey(token);
    } catch (err) {
      console.error("[justflows] mcp key verification error", JSON.stringify(logSafe(String(err))));
      challenge(req, res, true);
      return;
    }
    if (!verified) {
      challenge(req, res, true);
      return;
    }
    const { record, owner, rejection } = verified;
    const ip = clientIp(req);
    if (
      rejection ||
      !sessionMatchesRequestSite(owner.siteId) ||
      !ipAllowed(record, ip) ||
      !originAllowed(record, req.get("origin") ?? undefined)
    ) {
      await auditFailure(req, owner.siteId, record.id);
      challenge(req, res, true);
      return;
    }
    req.agentPrincipal = principalFromApiKey(record, owner);
    await recordApiKeyUse(record.id, ip);
    next();
  })().catch(next);
}

const WINDOW_MS = 60_000;

async function limitFor(req: Request): Promise<number> {
  const perKey = req.agentPrincipal?.key.rateLimitPerMin;
  if (typeof perKey === "number" && perKey > 0) return perKey;
  return getMcpRateLimit();
}

function tooMany(_req: Request, res: Response): void {
  if (!res.getHeader("Retry-After")) res.setHeader("Retry-After", String(WINDOW_MS / 1000));
  res.status(429).json({ error: "Too many requests" });
}

/** Per key/grant and per IP, read per request so setting changes apply at once. */
export const mcpRateLimit: RequestHandler[] = [
  rateLimit({
    windowMs: WINDOW_MS,
    limit: limitFor,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req: Request) => `mcp:${req.agentPrincipal?.id ?? "unknown"}`,
    handler: tooMany,
  }),
  rateLimit({
    windowMs: WINDOW_MS,
    limit: limitFor,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req: Request) => `mcp-ip:${ipKeyGenerator(req.ip ?? "unknown")}`,
    handler: tooMany,
  }),
];
