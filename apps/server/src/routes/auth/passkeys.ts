// SPDX-License-Identifier: MIT

import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { getDb } from "../../lib/database/db.js";
import { requireSession } from "../../middleware/auth.js";
import { closedToMembers } from "../../middleware/closed-to-members.js";
import { clientIp, consumeRateLimit, rateLimitRetryAfter } from "../../lib/security/rate-limit.js";
import { verifyPassword } from "../../lib/auth/password.js";
import { getSiteId } from "../../lib/settings/site-settings.js";
import { auditContext, auditFromRequest, auditLog } from "../../lib/security/audit-log.js";
import { getAdminPathConfig } from "../../lib/admin/admin-path.js";
import { knowsAdminPath, postAuthRedirect } from "../../lib/auth/auth-surface.js";
import { revokeOtherDeviceSessions } from "../../lib/auth/device-sessions.js";
import { finishSignIn } from "../../lib/auth/sign-in.js";
import { param } from "../../lib/http/params.js";
import { getPasskeyPolicy, modeForRole } from "../../lib/auth/webauthn/passkey-policy.js";
import {
  MAX_PASSKEYS_PER_USER,
  clearPasskeyDependants,
  countPasskeys,
  createChallenge,
  deletePasskey,
  insertPasskey,
  listPasskeys,
  renamePasskey,
} from "../../lib/auth/webauthn/passkeys-db.js";
import {
  PasskeyAnswerSchema,
  claimForRequest,
  creationOptions,
  homeSiteOf,
  relyingPartyFor,
  requestOptions,
  verifyDiscoverablePasskey,
} from "../../lib/auth/webauthn/ceremonies.js";
import { WebAuthnError, verifyRegistration, type RegistrationResponse } from "../../lib/auth/webauthn/webauthn.js";

/**
 * Passkeys (#105): registration and management from account security, and
 * passwordless sign-in. The second-factor use of a passkey lives in POST
 * /login, next to the password it follows.
 *
 * Adding a passkey creates a new way into the account, so it costs the current
 * password: a borrowed session must not be able to plant a credential that
 * outlives a password change. Revoking one costs the password too, and by
 * default signs every other device out.
 */

const router = Router();

function limiter(limit: number) {
  return rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false });
}
const manageLimit = limiter(100);
const registerOptionsLimit = limiter(30);
const registerVerifyLimit = limiter(30);
const signInOptionsLimit = limiter(100);
const signInVerifyLimit = limiter(60);
const recoveryLimit = limiter(30);

const GENERIC_SIGN_IN_FAILURE = "This passkey could not sign you in. Try again, or sign in with your password.";

/** Delay a refusal so a wrong password costs the same time as a right one. */
const slow = () => new Promise((r) => setTimeout(r, 300 + Math.random() * 200));

async function account(userId: string) {
  const db = await getDb();
  const rows = await db.query<{ site_id: string; password_hash: string; display_name: string | null; email: string }>(
    "SELECT site_id, password_hash, display_name, email FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  return rows[0] ? { ...rows[0], site_id: String(rows[0].site_id) } : null;
}

/** Same-site password re-check for account security changes, with its own budget. */
async function confirmPassword(req: Request, res: Response, password: string | undefined, key: string) {
  const session = req.session!;
  if (!consumeRateLimit(`passkey:${key}:${session.userId}`, 10, 15 * 60 * 1000)) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return null;
  }
  const row = await account(session.userId);
  if (!row || !password || !(await verifyPassword(password, row.password_hash))) {
    await slow();
    /** 403, not 401: the session is fine, and clients treat 401 as "signed out". */
    res.status(403).json({ error: "Password is incorrect" });
    return null;
  }
  return row;
}

function notify(email: string, alert: string): void {
  void import("../../lib/email/mail.js")
    .then((mail) => mail.sendTemplateMail({ to: email, key: "core.security-alert", values: { display_name: email, alert } }))
    .catch((err) => console.error("Passkey notice failed:", err));
}

async function siteName(siteId: string): Promise<string> {
  const db = await getDb();
  const rows = await db.query<{ name: string }>("SELECT name FROM sites WHERE id = ? LIMIT 1", [siteId]).catch(() => []);
  return rows[0]?.name?.trim() || "Justflows";
}

function publicPasskey(row: Awaited<ReturnType<typeof listPasskeys>>[number]) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    synced: row.backupState,
    transports: row.transports,
    aaguid: row.aaguid,
    attestationFormat: row.attestationFormat,
  };
}

// ── Management ───────────────────────────────────────────────────────────────

router.get("/passkeys", manageLimit, requireSession, async (req, res) => {
  const session = req.session!;
  try {
    const home = await homeSiteOf(session.userId);
    if (!home) { res.status(404).json({ error: "Account not found" }); return; }
    const policy = await getPasskeyPolicy(session.siteId);
    const { TotpUnavailableError, countRecoveryCodes, getTotpState } = await import("../../lib/auth/totp-db.js");
    let recoveryCodesRemaining: number | null = null;
    let totpEnabled = false;
    try {
      recoveryCodesRemaining = await countRecoveryCodes(session.userId, home);
      totpEnabled = (await getTotpState(session.userId, home)).enabled;
    } catch (err) {
      if (!(err instanceof TotpUnavailableError)) throw err;
    }
    res.json({
      passkeys: (await listPasskeys(session.userId, home)).map(publicPasskey),
      mode: modeForRole(policy, session.role),
      userVerification: policy.userVerification,
      maxPasskeys: MAX_PASSKEYS_PER_USER,
      recoveryCodesRemaining,
      totpEnabled,
    });
  } catch (err) {
    console.error("Passkey list error", err);
    res.status(500).json({ error: "Server error" });
  }
});

const RegisterOptionsSchema = z.object({ password: z.string().min(1).max(1024) });

router.post("/passkeys/register/options", registerOptionsLimit, requireSession, async (req, res) => {
  const session = req.session!;
  const body = RegisterOptionsSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Enter your password to add a passkey" }); return; }
  try {
    const row = await confirmPassword(req, res, body.data.password, "register");
    if (!row) return;
    const policy = await getPasskeyPolicy(session.siteId);
    if (modeForRole(policy, session.role) === "disallow") {
      res.status(403).json({ error: "Passkeys are turned off for your role on this site" });
      return;
    }
    const existing = await listPasskeys(session.userId, row.site_id);
    if (existing.length >= MAX_PASSKEYS_PER_USER) {
      res.status(409).json({ error: `You can register up to ${MAX_PASSKEYS_PER_USER} passkeys. Remove one first.` });
      return;
    }
    const rp = relyingPartyFor(req, policy);
    const { id, challenge } = await createChallenge({ siteId: session.siteId, userId: session.userId, purpose: "register", rpId: rp.rpId, origin: rp.origin });
    res.json(creationOptions(rp, {
      ceremonyId: id,
      challenge,
      siteName: await siteName(session.siteId),
      userId: session.userId,
      email: row.email,
      displayName: row.display_name ?? row.email,
      policy,
      existing,
    }));
  } catch (err) {
    console.error("Passkey options error", err);
    res.status(500).json({ error: "Server error" });
  }
});

const RegisterVerifySchema = PasskeyAnswerSchema.extend({ name: z.string().trim().max(100).optional() });

router.post("/passkeys/register/verify", registerVerifyLimit, requireSession, async (req, res) => {
  const session = req.session!;
  const body = RegisterVerifySchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "The passkey response is malformed" }); return; }
  try {
    const policy = await getPasskeyPolicy(session.siteId);
    if (modeForRole(policy, session.role) === "disallow") {
      res.status(403).json({ error: "Passkeys are turned off for your role on this site" });
      return;
    }
    const claim = await claimForRequest(req, policy, body.data.ceremonyId, session.siteId, "register");
    if (!claim || claim.claimed.userId !== session.userId) {
      res.status(400).json({ error: "This request has expired. Start again." });
      return;
    }
    const home = await homeSiteOf(session.userId);
    if (!home) { res.status(404).json({ error: "Account not found" }); return; }

    let verified;
    try {
      verified = verifyRegistration(body.data.credential as unknown as RegistrationResponse, {
        challenge: claim.claimed.challenge,
        origins: claim.rp.origins,
        rpId: claim.claimed.rpId,
        requireUserVerification: policy.userVerification === "required",
        attestation: policy.attestation,
        allowedAaguids: policy.allowedAaguids,
      });
    } catch (err) {
      if (err instanceof WebAuthnError) {
        auditFromRequest(req, "auth.passkey_registered", { outcome: "failure", detail: `${err.code}: ${err.message}`.slice(0, 200) });
        res.status(400).json({ error: err.code === "aaguid" ? err.message : "The passkey could not be verified. Try again." });
        return;
      }
      throw err;
    }

    if ((await countPasskeys(session.userId, home)) >= MAX_PASSKEYS_PER_USER) {
      res.status(409).json({ error: `You can register up to ${MAX_PASSKEYS_PER_USER} passkeys. Remove one first.` });
      return;
    }
    const name = body.data.name || (verified.backupState ? "Synced passkey" : verified.transports.includes("internal") ? "This device" : "Security key");
    const id = await insertPasskey({ userId: session.userId, siteId: home, name, ...verified });
    if (!id) {
      res.status(409).json({ error: "That passkey is already registered" });
      return;
    }

    /**
     * The first second factor gets recovery codes, shown once. An account that
     * already has codes (from TOTP or an earlier passkey) keeps them.
     */
    let recoveryCodes: string[] | undefined;
    const { countRecoveryCodes, setRecoveryCodes } = await import("../../lib/auth/totp-db.js");
    const remaining = await countRecoveryCodes(session.userId, home).catch(() => null);
    if (remaining === 0) {
      const { generateRecoveryCodes } = await import("../../lib/auth/totp.js");
      recoveryCodes = generateRecoveryCodes();
      if (!(await setRecoveryCodes(session.userId, home, recoveryCodes))) recoveryCodes = undefined;
    }

    auditFromRequest(req, "auth.passkey_registered", {
      target: id,
      detail: `${verified.attestationFormat}; aaguid ${verified.aaguid}; ${verified.backupState ? "synced" : "device-bound"}`,
    });
    notify(session.email, `A passkey ("${name}") was added to your account. If this was not you, sign in, remove it, and change your password.`);
    res.status(201).json({ ok: true, id, ...(recoveryCodes ? { recoveryCodes } : {}) });
  } catch (err) {
    console.error("Passkey register error", err);
    res.status(500).json({ error: "Server error" });
  }
});

const RenameSchema = z.object({ name: z.string().trim().min(1).max(100) });

router.patch("/passkeys/:id", manageLimit, requireSession, async (req, res) => {
  const session = req.session!;
  const body = RenameSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Give the passkey a name of up to 100 characters" }); return; }
  try {
    const home = await homeSiteOf(session.userId);
    if (!home || !(await renamePasskey(param(req.params.id), session.userId, home, body.data.name))) {
      res.status(404).json({ error: "Passkey not found" });
      return;
    }
    auditFromRequest(req, "auth.passkey_renamed", { target: param(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    console.error("Passkey rename error", err);
    res.status(500).json({ error: "Server error" });
  }
});

const RevokeSchema = z.object({ password: z.string().min(1).max(1024), signOutOthers: z.boolean().optional() });

router.post("/passkeys/:id/revoke", manageLimit, requireSession, async (req, res) => {
  const session = req.session!;
  const body = RevokeSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Enter your password to remove a passkey" }); return; }
  try {
    const row = await confirmPassword(req, res, body.data.password, "revoke");
    if (!row) return;
    const id = param(req.params.id);
    const passkeys = await listPasskeys(session.userId, row.site_id);
    const target = passkeys.find((passkey) => passkey.id === id);
    if (!target) { res.status(404).json({ error: "Passkey not found" }); return; }
    const policy = await getPasskeyPolicy(session.siteId);
    if (modeForRole(policy, session.role) === "require" && passkeys.length === 1) {
      res.status(409).json({ error: "Your role must use a passkey. Add another passkey before removing this one." });
      return;
    }
    if (!(await deletePasskey(id, session.userId, row.site_id))) { res.status(404).json({ error: "Passkey not found" }); return; }
    await clearPasskeyDependants(session.userId, row.site_id);

    /** A removed passkey is usually a lost device: end the sessions it may have opened. */
    let signedOut = 0;
    if (body.data.signOutOthers !== false && session.sid) {
      signedOut = await revokeOtherDeviceSessions(session.sid, session.userId, session.siteId);
    }
    auditFromRequest(req, "auth.passkey_revoked", { target: id, detail: `${target.name.slice(0, 100)}; other sessions ended: ${signedOut}` });
    notify(session.email, `A passkey ("${target.name}") was removed from your account. If this was not you, change your password now.`);
    res.json({ ok: true, signedOut });
  } catch (err) {
    console.error("Passkey revoke error", err);
    res.status(500).json({ error: "Server error" });
  }
});

const RegenerateSchema = z.object({ password: z.string().min(1).max(1024) });

/** A fresh set of recovery codes, replacing every unused one. */
router.post("/recovery-codes/regenerate", recoveryLimit, requireSession, async (req, res) => {
  const session = req.session!;
  const body = RegenerateSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Enter your password to create new recovery codes" }); return; }
  try {
    const row = await confirmPassword(req, res, body.data.password, "recovery");
    if (!row) return;
    const { getTotpState, setRecoveryCodes } = await import("../../lib/auth/totp-db.js");
    const hasFactor = (await countPasskeys(session.userId, row.site_id)) > 0 || (await getTotpState(session.userId, row.site_id)).enabled;
    if (!hasFactor) {
      res.status(409).json({ error: "Recovery codes back up a passkey or an authenticator app. Add one first." });
      return;
    }
    const { generateRecoveryCodes } = await import("../../lib/auth/totp.js");
    const codes = generateRecoveryCodes();
    if (!(await setRecoveryCodes(session.userId, row.site_id, codes))) {
      res.status(409).json({ error: "Recovery codes could not be changed" });
      return;
    }
    auditFromRequest(req, "auth.recovery_codes_regenerated");
    notify(session.email, "New recovery codes were created for your account. The old ones no longer work.");
    res.json({ ok: true, recoveryCodes: codes });
  } catch (err) {
    console.error("Recovery code error", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Passwordless sign-in ─────────────────────────────────────────────────────

router.post("/passkeys/login/options", signInOptionsLimit, closedToMembers, async (req, res) => {
  const ip = clientIp(req);
  if (!consumeRateLimit(`passkey:options:ip:${ip}`, 60, 15 * 60 * 1000)) {
    res.setHeader("Retry-After", String(rateLimitRetryAfter(`passkey:options:ip:${ip}`)));
    res.status(429).json({ error: "Too many sign-in attempts. Try again later." });
    return;
  }
  try {
    const siteId = await getSiteId();
    if (!siteId) { res.status(404).json({ error: "Not found" }); return; }
    const policy = await getPasskeyPolicy(siteId);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await requestOptions(req, policy, { siteId, userId: null, purpose: "login", passkeys: [], userVerification: "required" }));
  } catch (err) {
    console.error("Passkey sign-in options error", err);
    res.status(500).json({ error: "Server error" });
  }
});

const SignInSchema = PasskeyAnswerSchema.extend({ adminPath: z.string().max(128).optional() });

router.post("/passkeys/login/verify", signInVerifyLimit, closedToMembers, async (req, res) => {
  const ip = clientIp(req);
  if (!consumeRateLimit(`login:ip:${ip}`, 20, 15 * 60 * 1000)) {
    res.setHeader("Retry-After", String(rateLimitRetryAfter(`login:ip:${ip}`)));
    res.status(429).json({ error: "Too many login attempts. Try again later." });
    return;
  }
  const body = SignInSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid request" }); return; }

  const refuse = async (detail: string, actor?: { id: string; email: string; siteId: string }) => {
    if (actor) {
      void auditLog({ siteId: actor.siteId, action: "auth.login_failed", outcome: "failure", actorId: actor.id, actorEmail: actor.email, ...auditContext(req), detail: detail.slice(0, 200) });
    }
    await slow();
    res.status(401).json({ error: GENERIC_SIGN_IN_FAILURE });
  };

  try {
    const siteId = await getSiteId();
    if (!siteId) { await refuse("no site"); return; }
    const credentialKey = body.data.credential.rawId.slice(0, 64);
    if (!consumeRateLimit(`passkey:credential:${credentialKey}`, 10, 15 * 60 * 1000)) {
      res.status(429).json({ error: "Too many login attempts. Try again later." });
      return;
    }

    const check = await verifyDiscoverablePasskey(req, { requestSiteId: siteId, answer: body.data });
    if (!check.ok) {
      /** A known passkey that failed its checks is recorded against its owner. */
      const owner = check.userId ? await account(check.userId).catch(() => null) : null;
      await refuse(check.reason, owner && check.userId ? { id: check.userId, email: owner.email, siteId } : undefined);
      return;
    }
    const home = await account(check.passkey.userId);
    if (!home) { await refuse("account gone"); return; }

    /** The passkey names the account; it must still be able to sign in to this site. */
    const { findLoginAccount } = await import("../../lib/tenancy/access.js");
    const login = await findLoginAccount(siteId, home.email.toLowerCase());
    const actor = { id: check.passkey.userId, email: home.email, siteId };
    if (!login || login.id !== check.passkey.userId || login.homeSiteId !== check.passkey.siteId) {
      await refuse("account has no access to this site", actor);
      return;
    }
    const policy = await getPasskeyPolicy(siteId);
    if (modeForRole(policy, login.role) === "disallow") {
      await refuse("passkeys disallowed for role", actor);
      return;
    }

    /** Staff outside the hidden admin sign-in get the same refusal as an unknown passkey. */
    const adminPath = (await getAdminPathConfig()).path;
    const redirectTo = await postAuthRedirect(login.role, login.id, siteId);
    if (redirectTo === adminPath && !knowsAdminPath(body.data.adminPath, adminPath)) {
      await refuse("staff sign-in outside the admin path", actor);
      return;
    }

    const opened = await finishSignIn(req, res, {
      id: login.id,
      site_id: siteId,
      email: login.email,
      role: login.role,
      token_version: login.token_version,
    }, "passkey");
    if (!opened) { res.status(503).json({ error: "Sign-in could not be completed. Try again." }); return; }
    res.json({ ok: true, role: login.role, redirectTo });
  } catch (err) {
    console.error("Passkey sign-in error", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
