// SPDX-License-Identifier: MIT

import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { auditContext, auditFromRequest, auditLog } from "../../lib/security/audit-log.js";
import { getAdminPathConfig } from "../../lib/admin/admin-path.js";
import { knowsAdminPath, postAuthRedirect } from "../../lib/auth/auth-surface.js";
import { finishSignIn } from "../../lib/auth/sign-in.js";
import { getSiteId } from "../../lib/settings/site-settings.js";
import { publicOrigin } from "../../lib/ai/ai-settings.js";
import { requireSession } from "../../middleware/auth.js";
import { param } from "../../lib/http/params.js";
import { PasskeyAnswerSchema, requestOptions, usablePasskeys, verifyPasskeyForAccount } from "../../lib/auth/webauthn/ceremonies.js";
import {
  emailDomainAllowed,
  findLinkedUser,
  finishFlow,
  getOidcProviders,
  hasProviderLink,
  linkIdentity,
  listLinkedIdentities,
  openFlow,
  sealFlow,
  startFlow,
  touchIdentity,
  unlinkIdentity,
  type StartedFlow,
} from "../../lib/auth/oidc.js";

/**
 * Sign-in through an OpenID Connect provider (justflows-ce#54). Offered on the
 * staff sign-in page only. When the provider does not prove a second factor
 * and the account has one, the account's own factor is asked before the
 * session opens.
 */
const router = Router();
const flowLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
const FLOW_COOKIE = "jf_oidc";
const PENDING_COOKIE = "jf_oidc_pending";

interface PendingSignIn {
  u: string;
  s: string;
  h: string;
  role: string;
  p: string;
  exp: number;
}

function cookieOptions(path: string, maxAgeMs: number) {
  const secure = process.env.NODE_ENV === "production" || (process.env.APP_URL ?? "").startsWith("https://");
  return { httpOnly: true, sameSite: "lax" as const, secure, path, maxAge: maxAgeMs };
}

async function loginPage(query: string): Promise<string> {
  const adminPath = (await getAdminPathConfig()).path;
  return `${adminPath}/login?${query}`;
}

/** Enabled providers, for the sign-in page's buttons. Names only. */
router.get("/providers", async (_req, res) => {
  const siteId = await getSiteId();
  const providers = siteId ? await getOidcProviders(siteId) : [];
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ providers: providers.filter((provider) => provider.enabled && provider.clientId).map((provider) => ({ id: provider.id, name: provider.name })) });
});

/** Start a sign-in. The request must name the admin path, like the password sign-in on the staff page. */
router.post("/:id/start", flowLimit, async (req, res) => {
  try {
    const adminPath = (await getAdminPathConfig()).path;
    if (!knowsAdminPath((req.body as { adminPath?: unknown } | undefined)?.adminPath, adminPath)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const siteId = await getSiteId();
    const provider = siteId ? (await getOidcProviders(siteId)).find((item) => item.id === param(req.params.id) && item.enabled) : undefined;
    if (!siteId || !provider) {
      res.status(404).json({ error: "This sign-in option is not available" });
      return;
    }
    const redirectUri = `${publicOrigin(req)}/api/auth/oidc/${provider.id}/callback`;
    const flow = await startFlow(provider, siteId, redirectUri, true);
    res.cookie(FLOW_COOKIE, sealFlow(flow.state), cookieOptions("/api/auth/oidc", 10 * 60 * 1000));
    res.json({ url: flow.url });
  } catch (error) {
    console.error("OIDC start failed:", JSON.stringify(error instanceof Error ? error.message : String(error)));
    res.status(502).json({ error: "The sign-in provider could not be reached" });
  }
});

async function refuse(req: Request, res: Response, siteId: string | null, reason: string, actor?: { id: string; email: string }): Promise<void> {
  if (siteId) {
    void auditLog({
      siteId,
      action: "auth.login_failed",
      outcome: "failure",
      ...(actor ? { actorId: actor.id, actorEmail: actor.email } : {}),
      ...auditContext(req),
      detail: reason.slice(0, 200),
    });
  }
  res.clearCookie(FLOW_COOKIE, { path: "/api/auth/oidc" });
  res.redirect(303, await loginPage("federated=error"));
}

router.get("/:id/callback", flowLimit, async (req, res) => {
  const flow = openFlow<StartedFlow["state"]>(req.cookies?.[FLOW_COOKIE]);
  const siteId = await getSiteId();
  const providerId = param(req.params.id);
  if (!flow || !siteId || flow.s !== siteId || flow.p !== providerId) {
    await refuse(req, res, siteId, `oidc:${providerId} missing or expired sign-in state`);
    return;
  }
  const provider = (await getOidcProviders(siteId)).find((item) => item.id === providerId && item.enabled);
  if (!provider) {
    await refuse(req, res, siteId, `oidc:${providerId} provider not enabled`);
    return;
  }
  let identity;
  try {
    identity = await finishFlow(provider, new URL(`${publicOrigin(req)}${req.originalUrl}`), flow);
  } catch (error) {
    await refuse(req, res, siteId, `oidc:${provider.id} ${error instanceof Error ? error.message : "token check failed"}`);
    return;
  }
  res.clearCookie(FLOW_COOKIE, { path: "/api/auth/oidc" });

  const { findLoginAccount } = await import("../../lib/tenancy/access.js");
  const { getDb } = await import("../../lib/database/db.js");
  const db = await getDb();
  /** A linked subject identifies the person; email only links an account the first time. */
  const linked = await db.query<{ user_id: string; site_id: string; email: string }>(
    `SELECT ui.user_id, ui.site_id, u.email FROM user_identities ui JOIN users u ON u.id = ui.user_id
     WHERE ui.provider_id = ? AND ui.subject = ? LIMIT 5`,
    [provider.id, identity.subject],
  );
  let account = null;
  for (const row of linked) {
    const candidate = await findLoginAccount(siteId, String(row.email).toLowerCase());
    if (candidate && candidate.id === String(row.user_id) && (await findLinkedUser(candidate.homeSiteId, provider.id, identity.subject)) === candidate.id) {
      account = candidate;
      break;
    }
  }
  if (!account) {
    if (!identity.email || !identity.emailVerified) {
      await refuse(req, res, siteId, `oidc:${provider.id} no linked account and no verified email`);
      return;
    }
    if (!emailDomainAllowed(provider, identity.email)) {
      await refuse(req, res, siteId, `oidc:${provider.id} email domain not allowed`);
      return;
    }
    account = await findLoginAccount(siteId, identity.email);
    if (!account) {
      await refuse(req, res, siteId, `oidc:${provider.id} no account for this identity`);
      return;
    }
    if (await hasProviderLink(account.homeSiteId, account.id, provider.id)) {
      await refuse(req, res, siteId, `oidc:${provider.id} account is linked to a different identity at this provider`, { id: account.id, email: account.email });
      return;
    }
    await linkIdentity({ homeSiteId: account.homeSiteId, userId: account.id, providerId: provider.id, subject: identity.subject, email: identity.email });
    void auditLog({ siteId, action: "auth.identity_linked", actorId: account.id, actorEmail: account.email, target: provider.id, ...auditContext(req), detail: "linked by verified email at first sign-in" });
  }
  await touchIdentity(account.homeSiteId, provider.id, identity.subject).catch(() => undefined);

  const signIn = { id: account.id, site_id: account.siteId, email: account.email, role: account.role, token_version: account.token_version };
  /** The provider proved a second factor: that is enough. Otherwise the account's own factor is asked. */
  if (!identity.mfa) {
    const { secondFactorsOf } = await import("../../lib/auth/mfa-policy.js");
    const factors = await secondFactorsOf(account.id);
    if (factors.totp || factors.passkeys > 0) {
      const pending: PendingSignIn = { u: account.id, s: account.siteId, h: account.homeSiteId, role: account.role, p: provider.id, exp: Date.now() + 5 * 60 * 1000 };
      res.cookie(PENDING_COOKIE, sealFlow({ ...pending }), cookieOptions("/api/auth/oidc", 5 * 60 * 1000));
      res.redirect(303, await loginPage("federated=1"));
      return;
    }
  }
  if (!(await finishSignIn(req, res, signIn, `oidc:${provider.id}`))) {
    await refuse(req, res, siteId, `oidc:${provider.id} session could not be stored`);
    return;
  }
  res.redirect(303, await postAuthRedirect(account.role, account.id, account.siteId));
});

/** The factors a pending provider sign-in may finish with. */
router.post("/pending", flowLimit, async (req, res) => {
  const pending = openFlow<PendingSignIn>(req.cookies?.[PENDING_COOKIE]);
  if (!pending) {
    res.status(401).json({ error: "The sign-in has expired. Start again." });
    return;
  }
  const { getTotpState } = await import("../../lib/auth/totp-db.js");
  const totp = await getTotpState(pending.u, pending.h).catch(() => null);
  const factors = await usablePasskeys(pending.s, pending.h, pending.u, pending.role);
  const passkeyAccepted = factors.passkeys.length > 0;
  const passkeyOptions = passkeyAccepted
    ? await requestOptions(req, factors.policy, { siteId: pending.s, userId: pending.u, purpose: "second", passkeys: factors.passkeys, userVerification: factors.policy.userVerification })
    : undefined;
  res.json({ totpAccepted: Boolean(totp?.enabled) && !(factors.mode === "require" && passkeyAccepted), ...(passkeyOptions ? { passkeyOptions } : {}) });
});

const CompleteSchema = z.object({ totp: z.string().max(64).optional(), passkey: PasskeyAnswerSchema.optional() });

/** Finish a provider sign-in with the account's authenticator code, recovery code, or passkey. */
router.post("/complete", flowLimit, async (req, res) => {
  const pending = openFlow<PendingSignIn>(req.cookies?.[PENDING_COOKIE]);
  const body = CompleteSchema.safeParse(req.body);
  if (!pending || !body.success) {
    res.status(401).json({ error: "The sign-in has expired. Start again." });
    return;
  }
  const { getDb } = await import("../../lib/database/db.js");
  const users = await (await getDb()).query<{ email: string; role: string; token_version: number | null }>(
    "SELECT email, role, token_version FROM users WHERE id = ? LIMIT 1",
    [pending.u],
  );
  const user = users[0];
  if (!user) {
    res.status(401).json({ error: "The sign-in has expired. Start again." });
    return;
  }
  const { claimTotpStep, consumeRecoveryCode, getTotpState } = await import("../../lib/auth/totp-db.js");
  const { acceptedTotpStep } = await import("../../lib/auth/totp.js");
  const factors = await usablePasskeys(pending.s, pending.h, pending.u, pending.role);
  const totp = await getTotpState(pending.u, pending.h);
  const totpAccepted = totp.enabled && !(factors.mode === "require" && factors.passkeys.length > 0);
  let ok = false;
  if (body.data.passkey && factors.passkeys.length > 0) {
    ok = (await verifyPasskeyForAccount(req, { requestSiteId: pending.s, homeSiteId: pending.h, userId: pending.u, role: pending.role, answer: body.data.passkey, purpose: "second", requireUserVerification: false })).ok;
  } else if (body.data.totp?.trim()) {
    const code = body.data.totp.trim();
    const step = totpAccepted ? acceptedTotpStep(totp.secret ?? "", code) : null;
    ok = step !== null ? await claimTotpStep(pending.u, pending.h, step) : await consumeRecoveryCode(pending.u, pending.h, code);
  }
  if (!ok) {
    void auditLog({ siteId: pending.s, action: "auth.login_failed", outcome: "failure", actorId: pending.u, actorEmail: user.email, ...auditContext(req), detail: `oidc:${pending.p} wrong second factor` });
    await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 200));
    res.status(401).json({ error: body.data.passkey ? "That passkey could not be verified" : "That code is not valid" });
    return;
  }
  res.clearCookie(PENDING_COOKIE, { path: "/api/auth/oidc" });
  const signedIn = await finishSignIn(req, res, { id: pending.u, site_id: pending.s, email: user.email, role: pending.role, token_version: user.token_version }, `oidc:${pending.p}`);
  if (!signedIn) {
    res.status(503).json({ error: "Sign-in could not be completed. Try again." });
    return;
  }
  res.json({ ok: true, role: pending.role, redirectTo: await postAuthRedirect(pending.role, pending.u, pending.s) });
});

export const identityRoutes = Router();

/** The provider identities linked to the signed-in account. */
identityRoutes.get("/", requireSession, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ identities: await listLinkedIdentities(req.session!.userId) });
});

identityRoutes.delete("/:id", flowLimit, requireSession, async (req, res) => {
  const removed = await unlinkIdentity(req.session!.userId, param(req.params.id));
  if (!removed) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  auditFromRequest(req, "auth.identity_unlinked", { target: param(req.params.id) });
  res.json({ ok: true });
});

export default router;
