// SPDX-License-Identifier: MIT

import { z } from "zod";
import { getSiteSetting, setSiteSetting } from "../settings/site-settings.js";

/**
 * The administrator MFA policy (justflows-ce#54): roles that must use a second
 * factor, an authenticator app or a passkey. Enforced on the server: an
 * account in such a role without a factor can sign in, but every API except
 * the ones that enrol a factor or sign out answers 403 until it has one. The
 * passkey policy's `require` mode is enforced the same way.
 */

export const MFA_POLICY_SETTING_KEY = "security.mfa";

const PolicySchema = z.object({
  requiredRoles: z.array(z.string().regex(/^[a-z0-9_.:-]{1,80}$/)).max(50).default([]),
});

export type MfaPolicy = z.infer<typeof PolicySchema>;

export const DEFAULT_MFA_POLICY: MfaPolicy = { requiredRoles: [] };

export function normalizeMfaPolicy(raw: unknown): MfaPolicy {
  const parsed = PolicySchema.safeParse(raw ?? {});
  return parsed.success ? { requiredRoles: [...new Set(parsed.data.requiredRoles)] } : { ...DEFAULT_MFA_POLICY };
}

const CACHE_MS = 15_000;
const policyCache = new Map<string, { at: number; policy: MfaPolicy }>();
const factorCache = new Map<string, { at: number; factors: SecondFactors }>();

export async function getMfaPolicy(siteId: string): Promise<MfaPolicy> {
  const hit = policyCache.get(siteId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.policy;
  const policy = normalizeMfaPolicy(await getSiteSetting(siteId, MFA_POLICY_SETTING_KEY));
  policyCache.set(siteId, { at: Date.now(), policy });
  return policy;
}

export async function saveMfaPolicy(siteId: string, raw: unknown): Promise<MfaPolicy> {
  const parsed = PolicySchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid MFA policy");
  const policy = { requiredRoles: [...new Set(parsed.data.requiredRoles)] };
  await setSiteSetting(siteId, MFA_POLICY_SETTING_KEY, policy);
  policyCache.delete(siteId);
  return policy;
}

export interface SecondFactors {
  totp: boolean;
  passkeys: number;
}

/** Forget cached factor state after an account enrols or removes a factor. */
export function forgetSecondFactors(userId: string): void {
  for (const key of factorCache.keys()) if (key.startsWith(`${userId}:`)) factorCache.delete(key);
}

/** The second factors an account has, read from its home site. Unknown state counts as none. */
export async function secondFactorsOf(userId: string): Promise<SecondFactors> {
  const { homeSiteOf } = await import("./webauthn/ceremonies.js");
  const home = await homeSiteOf(userId);
  if (!home) return { totp: false, passkeys: 0 };
  const key = `${userId}:${home}`;
  const hit = factorCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.factors;
  const [{ getTotpState }, { countPasskeys }] = await Promise.all([import("./totp-db.js"), import("./webauthn/passkeys-db.js")]);
  const [totp, passkeys] = await Promise.all([
    getTotpState(userId, home).then((state) => state.enabled, () => false),
    countPasskeys(userId, home).catch(() => 0),
  ]);
  const factors = { totp, passkeys };
  factorCache.set(key, { at: Date.now(), factors });
  return factors;
}

export type EnrolmentRequirement = "mfa" | "passkey" | null;

/** What this account must still enrol before it may use the admin, if anything. */
export async function enrolmentRequirement(session: { userId: string; siteId: string; role: string }): Promise<EnrolmentRequirement> {
  if (!session.siteId) return null;
  const [{ getPasskeyPolicy, modeForRole }, policy] = await Promise.all([import("./webauthn/passkey-policy.js"), getMfaPolicy(session.siteId)]);
  const passkeyMode = modeForRole(await getPasskeyPolicy(session.siteId), session.role);
  const mfaRequired = policy.requiredRoles.includes(session.role);
  if (passkeyMode !== "require" && !mfaRequired) return null;
  const factors = await secondFactorsOf(session.userId);
  if (passkeyMode === "require" && factors.passkeys === 0) return "passkey";
  if (mfaRequired && !factors.totp && factors.passkeys === 0) return "mfa";
  return null;
}

/**
 * APIs an account that still has to enrol a factor may use: who am I, enrol a
 * second factor, change the password, and sign out or end sessions.
 */
const ENROLMENT_PATHS = [
  "/api/auth/me",
  "/api/auth/logout",
  "/api/auth/2fa",
  "/api/auth/passkeys",
  "/api/auth/sessions",
  "/api/auth/password",
  "/api/auth/identities",
];

export function allowedDuringEnrolment(originalUrl: string): boolean {
  const path = originalUrl.split("?")[0] ?? "";
  return ENROLMENT_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
