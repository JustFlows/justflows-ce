// SPDX-License-Identifier: MIT

import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { isMcpEnabled, mcpResourceUrl, publicOrigin } from "../../lib/ai/ai-settings.js";
import {
  authenticateClient,
  exchangeAuthorizationCode,
  getClientByClientId,
  OAuthError,
  refreshAccessToken,
  registerClient,
  revokeToken,
  signAuthorizationRequest,
  type OAuthClient,
} from "../../lib/ai/oauth/oauth-store.js";
import { getSiteId } from "../../lib/settings/site-settings.js";
import { auditLog } from "../../lib/security/audit-log.js";
import { clientIp } from "../../lib/security/rate-limit.js";
import { logSafe } from "../../lib/security/log-safe.js";

/**
 * The OAuth 2.1 authorization server for MCP (#159), mounted at the site root:
 *
 * - `/.well-known/oauth-protected-resource[/api/mcp]` — RFC 9728
 * - `/.well-known/oauth-authorization-server` — RFC 8414
 * - `POST /oauth/register` — RFC 7591 dynamic client registration
 * - `GET /oauth/authorize` — authorization code + PKCE (S256 only); hands the
 *   signed request to the admin consent screen at `/oauth/consent`
 * - `POST /oauth/token` — code exchange and refresh-token rotation
 * - `POST /oauth/revoke` — RFC 7009
 *
 * None of it is under `/api`, so the cookie CSRF check does not apply: these
 * endpoints carry no ambient credential. Everything answers 404 while MCP is
 * off. Each endpoint has its own, stricter express-rate-limit.
 */
const router = Router();

function limiter(name: string, limit: number, windowMs = 60_000) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => `oauth-${name}:${clientIp(req)}`,
    handler: (_req, res) => {
      res.status(429).json({ error: "slow_down", error_description: "Too many requests" });
    },
  });
}

const metadataLimit = limiter("metadata", 120);
const registerLimit = limiter("register", 20, 60 * 60_000);
const authorizeLimit = limiter("authorize", 30);
const tokenLimit = limiter("token", 60);
const revokeLimit = limiter("revoke", 60);

function enabled(req: Request, res: Response, next: NextFunction): void {
  isMcpEnabled()
    .then((on) => {
      if (on) next();
      else res.status(404).json({ error: "not_found" });
    })
    .catch(next);
}

/** Machine endpoints carry no cookies, so any origin may call them. */
function openCors(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
}

function oauthError(res: Response, err: unknown): void {
  if (err instanceof OAuthError) {
    if (err.code === "invalid_client") res.setHeader("WWW-Authenticate", 'Basic realm="justflows"');
    res.status(err.code === "invalid_client" ? 401 : err.status).json({ error: err.code, error_description: err.message });
    return;
  }
  console.error("[justflows] oauth error", JSON.stringify(logSafe(String(err))));
  res.status(500).json({ error: "server_error" });
}

/** The resources a token may be bound to: the MCP endpoint and the management API. */
function allowedResources(req: Request): string[] {
  return [mcpResourceUrl(req), `${publicOrigin(req)}/api/manage/v1`];
}

/* ------------------------------- metadata -------------------------------- */

function protectedResource(resourcePath: string) {
  return (req: Request, res: Response) => {
    const origin = publicOrigin(req);
    res.json({
      resource: `${origin}${resourcePath}`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"],
      resource_name: resourcePath === "/api/mcp" ? "Justflows MCP server" : "Justflows management API",
      resource_documentation: "https://github.com/JustFlows/justflows-ce/blob/main/docs/AI.md",
    });
  };
}

const metadataChain = [metadataLimit, enabled, openCors, noStore];
router.all("/.well-known/oauth-protected-resource", ...metadataChain, protectedResource("/api/mcp"));
router.all("/.well-known/oauth-protected-resource/api/mcp", ...metadataChain, protectedResource("/api/mcp"));
router.all("/.well-known/oauth-protected-resource/api/manage/v1", ...metadataChain, protectedResource("/api/manage/v1"));

function authorizationServerMetadata(req: Request, res: Response): void {
  const origin = publicOrigin(req);
  res.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ["mcp"],
    authorization_response_iss_parameter_supported: true,
  });
}
router.all("/.well-known/oauth-authorization-server", ...metadataChain, authorizationServerMetadata);
router.all("/.well-known/oauth-authorization-server/api/mcp", ...metadataChain, authorizationServerMetadata);

/* ----------------------------- registration ------------------------------ */

router.post("/oauth/register", registerLimit, enabled, openCors, noStore, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const siteId = await getSiteId();
    if (!siteId) throw new OAuthError("server_error", "Site is not installed", 500);
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((item): item is string => typeof item === "string")
      : [];
    const grantTypes = Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code"];
    if (grantTypes.some((type) => type !== "authorization_code" && type !== "refresh_token")) {
      throw new OAuthError("invalid_client_metadata", "Only authorization_code and refresh_token are supported");
    }
    const responseTypes = Array.isArray(body.response_types) ? body.response_types : ["code"];
    if (responseTypes.some((type) => type !== "code")) {
      throw new OAuthError("invalid_client_metadata", "Only the code response type is supported");
    }
    const { client, clientSecret } = await registerClient({
      siteId,
      clientName: typeof body.client_name === "string" ? body.client_name : "MCP client",
      redirectUris,
      clientUri: typeof body.client_uri === "string" ? body.client_uri : null,
      tokenEndpointAuthMethod:
        typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : undefined,
    });
    void auditLog({
      siteId,
      action: "oauth.client_registered",
      target: client.clientId,
      ip: clientIp(req),
      userAgent: req.get("user-agent") ?? null,
      detail: `name=${client.clientName}`,
    });
    res.status(201).json({
      client_id: client.clientId,
      ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000) || Math.floor(Date.now() / 1000),
      client_name: client.clientName,
      ...(client.clientUri ? { client_uri: client.clientUri } : {}),
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      scope: "mcp",
    });
  } catch (err) {
    oauthError(res, err);
  }
});

/* ------------------------------ authorization ---------------------------- */

function plainError(res: Response, message: string): void {
  res.status(400).type("text/plain").send(`Authorization request rejected: ${message}`);
}

router.get("/oauth/authorize", authorizeLimit, enabled, noStore, async (req: Request, res: Response) => {
  const q = req.query as Record<string, unknown>;
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  try {
    const client = await getClientByClientId(str(q.client_id));
    // Without a known client and an exact redirect URI match there is nowhere
    // safe to send an error, so it is shown here instead (RFC 6749 §4.1.2.1).
    if (!client) return plainError(res, "unknown client_id.");
    const redirectUri = str(q.redirect_uri);
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      return plainError(res, "redirect_uri does not exactly match a registered URI.");
    }
    const state = str(q.state) || null;
    const back = (error: string, description: string) => {
      const url = new URL(redirectUri);
      url.searchParams.set("error", error);
      url.searchParams.set("error_description", description);
      if (state) url.searchParams.set("state", state);
      url.searchParams.set("iss", publicOrigin(req));
      res.redirect(302, url.toString());
    };
    if (str(q.response_type) !== "code") return back("unsupported_response_type", "Only response_type=code is supported");
    const challenge = str(q.code_challenge);
    if (!challenge || str(q.code_challenge_method) !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
      return back("invalid_request", "PKCE with code_challenge_method=S256 is required");
    }
    const resource = str(q.resource) || mcpResourceUrl(req);
    if (!allowedResources(req).includes(resource)) return back("invalid_target", "Unknown resource");

    const request = signAuthorizationRequest({
      clientId: client.clientId,
      redirectUri,
      codeChallenge: challenge,
      state,
      resource,
      scope: str(q.scope) || null,
    });
    res.redirect(302, `/oauth/consent?request=${encodeURIComponent(request)}`);
  } catch (err) {
    console.error("[justflows] oauth authorize error", JSON.stringify(logSafe(String(err))));
    plainError(res, "the server could not process the request.");
  }
});

/* --------------------------------- tokens -------------------------------- */

async function clientFromRequest(req: Request): Promise<OAuthClient> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  let clientId = typeof body.client_id === "string" ? body.client_id : "";
  let secret = typeof body.client_secret === "string" ? body.client_secret : undefined;
  // Parsed without a regex: `\s+(.+)` backtracks quadratically on long runs of spaces.
  const authorization = req.get("authorization") ?? "";
  const basic =
    authorization.slice(0, 6).toLowerCase() === "basic " ? authorization.slice(6).trim() : "";
  if (basic) {
    const decoded = Buffer.from(basic, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon > 0) {
      clientId = decodeURIComponent(decoded.slice(0, colon));
      secret = decodeURIComponent(decoded.slice(colon + 1));
    }
  }
  const client = await getClientByClientId(clientId);
  if (!client || !(await authenticateClient(client, secret))) {
    throw new OAuthError("invalid_client", "Client authentication failed", 401);
  }
  return client;
}

router.post("/oauth/token", tokenLimit, enabled, openCors, noStore, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const client = await clientFromRequest(req);
    const resource = typeof body.resource === "string" ? body.resource : undefined;
    if (resource !== undefined && !allowedResources(req).includes(resource)) {
      throw new OAuthError("invalid_target", "Unknown resource");
    }
    if (body.grant_type === "authorization_code") {
      res.json(
        await exchangeAuthorizationCode({
          client,
          code: body.code,
          redirectUri: body.redirect_uri,
          codeVerifier: body.code_verifier,
          resource,
        }),
      );
      return;
    }
    if (body.grant_type === "refresh_token") {
      res.json(await refreshAccessToken({ client, refreshToken: body.refresh_token, resource }));
      return;
    }
    throw new OAuthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported");
  } catch (err) {
    oauthError(res, err);
  }
});

router.post("/oauth/revoke", revokeLimit, enabled, openCors, noStore, async (req: Request, res: Response) => {
  try {
    const client = await clientFromRequest(req);
    await revokeToken(client, (req.body as Record<string, unknown> | undefined)?.token);
    res.status(200).json({});
  } catch (err) {
    oauthError(res, err);
  }
});

router.options(["/oauth/register", "/oauth/token", "/oauth/revoke"], openCors);

export default router;
