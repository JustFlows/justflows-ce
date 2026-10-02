// SPDX-License-Identifier: MIT

import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { UserCapability } from "@justflows/sdk";
import { requireSession } from "../../middleware/auth.js";
import { getEffectiveAccess, userCan } from "../../lib/auth/access-policy.js";
import { isMcpEnabled, publicOrigin } from "../../lib/ai/ai-settings.js";
import {
  getClientByClientId,
  getGrant,
  issueAuthorizationCode,
  listGrants,
  revokeGrant,
  verifyAuthorizationRequest,
  type OAuthGrant,
} from "../../lib/ai/oauth/oauth-store.js";
import { auditFromRequest } from "../../lib/security/audit-log.js";
import { clientIp } from "../../lib/security/rate-limit.js";
import { sendServerError } from "../../lib/http/send-error.js";

/**
 * Cookie-authenticated OAuth surfaces for the admin (#159), mounted at
 * `/api/oauth` (so the CSRF check applies to every write):
 *
 * - `GET /consent?request=…` — what the consent screen shows: client name,
 *   redirect URI, and the capabilities that can be granted (the user's own).
 * - `POST /consent` — approve (optionally narrowed) or deny. Returns the URL to
 *   send the browser to. Consent is never given without a signed-in user.
 * - `GET /grants` — the caller's own connected apps; `?all=1` lists every
 *   grant on the site for `settings:manage`.
 * - `DELETE /grants/:id` — revoke one; takes effect on the client's next call.
 */
const router = Router();
router.use(requireSession);

const consentLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `oauth-consent:${req.session?.userId ?? clientIp(req)}`,
});

/** Capabilities the MCP grant may never carry, regardless of what the user holds. */
const NEVER_GRANTED = new Set<string>(["ai:use"]);

async function grantableCapabilities(req: Request): Promise<UserCapability[]> {
  const session = req.session!;
  const access = await getEffectiveAccess(session.userId, session.siteId, session.role);
  return [...access.capabilities].filter((capability) => !NEVER_GRANTED.has(capability)).sort();
}

function grantDto(grant: OAuthGrant) {
  return {
    id: grant.id,
    clientId: grant.clientId,
    clientName: grant.clientName,
    userId: grant.userId,
    userEmail: grant.userEmail,
    userName: grant.userName,
    capabilities: grant.capabilities,
    userTools: grant.userTools,
    resource: grant.resource,
    createdAt: grant.createdAt,
    lastUsedAt: grant.lastUsedAt,
  };
}

router.get("/consent", consentLimit, async (req, res) => {
  try {
    if (!(await isMcpEnabled())) return void res.status(404).json({ error: "AI agents are not enabled on this site." });
    const request = verifyAuthorizationRequest(req.query.request);
    if (!request) return void res.status(400).json({ error: "This authorization request is invalid or has expired. Start again from your AI app." });
    const client = await getClientByClientId(request.clientId);
    if (!client || !client.redirectUris.includes(request.redirectUri)) {
      return void res.status(400).json({ error: "This authorization request is invalid or has expired. Start again from your AI app." });
    }
    const capabilities = await grantableCapabilities(req);
    res.json({
      client: { name: client.clientName, uri: client.clientUri, redirectUri: request.redirectUri },
      resource: request.resource,
      capabilities,
      canGrantUserTools: capabilities.includes("users:manage"),
      user: { email: req.session!.email },
    });
  } catch (err) {
    sendServerError(res, "oauth.consent", err);
  }
});

const DecisionSchema = z.object({
  request: z.string().min(1).max(8000),
  approve: z.boolean(),
  capabilities: z.array(z.string().max(80)).max(250).optional(),
  userTools: z.boolean().optional(),
});

router.post("/consent", consentLimit, async (req, res) => {
  const body = DecisionSchema.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid request" });
  try {
    if (!(await isMcpEnabled())) return void res.status(404).json({ error: "AI agents are not enabled on this site." });
    const request = verifyAuthorizationRequest(body.data.request);
    const client = request ? await getClientByClientId(request.clientId) : null;
    if (!request || !client || !client.redirectUris.includes(request.redirectUri)) {
      return void res.status(400).json({ error: "This authorization request is invalid or has expired. Start again from your AI app." });
    }
    const redirect = new URL(request.redirectUri);
    if (request.state) redirect.searchParams.set("state", request.state);
    redirect.searchParams.set("iss", publicOrigin(req));

    if (!body.data.approve) {
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set("error_description", "The user denied access");
      return void res.json({ redirectTo: redirect.toString() });
    }

    // Narrowing only: anything not in the user's own set is dropped, never added.
    const grantable = await grantableCapabilities(req);
    const requested = body.data.capabilities ?? grantable;
    const capabilities = requested.filter((capability) => grantable.includes(capability)) as UserCapability[];
    if (capabilities.length === 0) return void res.status(400).json({ error: "Choose at least one permission." });
    const session = req.session!;
    const userTools =
      body.data.userTools === true &&
      capabilities.includes("users:manage") &&
      (await userCan(session, "users:manage"));

    const { code, grantId } = await issueAuthorizationCode({
      siteId: session.siteId,
      client,
      userId: session.userId,
      capabilities,
      userTools,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      resource: request.resource,
    });
    auditFromRequest(req, "oauth.grant_created", {
      target: grantId,
      detail: `client=${client.clientId} name=${client.clientName} caps=${capabilities.length}${userTools ? " user_tools" : ""}`,
    });
    redirect.searchParams.set("code", code);
    res.json({ redirectTo: redirect.toString() });
  } catch (err) {
    sendServerError(res, "oauth.consent", err);
  }
});

router.get("/grants", async (req, res) => {
  try {
    const session = req.session!;
    const all = req.query.all === "1";
    if (all && !(await userCan(session, "settings:manage"))) return void res.status(403).json({ error: "Forbidden" });
    const grants = await listGrants(session.siteId, all ? {} : { userId: session.userId });
    res.json({ grants: grants.map(grantDto) });
  } catch (err) {
    sendServerError(res, "oauth.grants", err);
  }
});

router.delete("/grants/:id", async (req, res) => {
  try {
    const session = req.session!;
    const grant = await getGrant(req.params.id);
    if (!grant || grant.siteId !== session.siteId || grant.revokedAt) {
      return void res.status(404).json({ error: "Not found" });
    }
    if (grant.userId !== session.userId && !(await userCan(session, "settings:manage"))) {
      return void res.status(404).json({ error: "Not found" });
    }
    await revokeGrant(grant.id, grant.userId === session.userId ? "user" : "admin");
    auditFromRequest(req, "oauth.grant_revoked", { target: grant.id, detail: `client=${grant.clientId}` });
    res.status(204).end();
  } catch (err) {
    sendServerError(res, "oauth.grants", err);
  }
});

export default router;
