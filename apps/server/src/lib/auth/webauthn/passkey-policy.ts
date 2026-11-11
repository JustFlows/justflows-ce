// SPDX-License-Identifier: MIT

import { z } from "zod";
import { getSiteSetting, setSiteSetting } from "../../settings/site-settings.js";
import { STORED_ROLE_ID } from "../rbac.js";

/**
 * The operator's passkey policy for one site (#105).
 *
 * - Per role: `allow` (may register and sign in with passkeys), `require` (must
 *   use one: once the account has a passkey, a password and an authenticator
 *   code are no longer enough), or `disallow` (cannot register, and existing
 *   passkeys are not accepted for sign-in).
 * - User verification: `required` makes every passkey ceremony prove a PIN or
 *   biometric. Passwordless sign-in always requires it, whatever this says,
 *   because there the passkey is both factors.
 * - Attestation: `none` (default; what synced passkeys send) or `direct`, which
 *   verifies `packed` and `fido-u2f` statements and enables the AAGUID list.
 * - Relying party: by default the RP ID is the hostname the site is served on.
 *   An operator can widen it to a parent domain, and accept extra origins (for
 *   example, the same site on a second subdomain).
 */

export const PASSKEY_POLICY_SETTING_KEY = "security.passkeys";

export const PASSKEY_ROLE_MODES = ["allow", "require", "disallow"] as const;
export type PasskeyRoleMode = (typeof PASSKEY_ROLE_MODES)[number];

export interface PasskeyPolicy {
  defaultMode: PasskeyRoleMode;
  roles: Record<string, PasskeyRoleMode>;
  userVerification: "required" | "preferred";
  attestation: "none" | "direct";
  allowedAaguids: string[];
  rpId: string | null;
  extraOrigins: string[];
}

export const DEFAULT_PASSKEY_POLICY: PasskeyPolicy = Object.freeze({
  defaultMode: "allow",
  roles: {},
  userVerification: "preferred",
  attestation: "none",
  allowedAaguids: [],
  rpId: null,
  extraOrigins: [],
}) as PasskeyPolicy;

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const AAGUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname.endsWith(".localhost"))) return url.origin;
    return null;
  } catch {
    return null;
  }
}

export const PasskeyPolicySchema = z.object({
  defaultMode: z.enum(PASSKEY_ROLE_MODES),
  roles: z.record(z.string().regex(STORED_ROLE_ID), z.enum(PASSKEY_ROLE_MODES)).refine((value) => Object.keys(value).length <= 100, "Too many roles"),
  userVerification: z.enum(["required", "preferred"]),
  attestation: z.enum(["none", "direct"]),
  allowedAaguids: z.array(z.string().trim().toLowerCase().regex(AAGUID, "Each AAGUID must look like 00000000-0000-0000-0000-000000000000")).max(100),
  rpId: z.string().trim().toLowerCase().max(253).regex(HOSTNAME, "The RP ID must be a hostname such as example.com").nullable(),
  extraOrigins: z.array(z.string().max(300)).max(20).transform((values, ctx) => {
    const out: string[] = [];
    for (const value of values) {
      const origin = normalizeOrigin(value);
      if (!origin) {
        ctx.addIssue({ code: "custom", message: `"${value.slice(0, 80)}" is not an https origin such as https://example.com` });
        return z.NEVER;
      }
      if (!out.includes(origin)) out.push(origin);
    }
    return out;
  }),
});

/** Read whatever is stored, falling back field by field so a bad value never locks anyone out. */
export function normalizePasskeyPolicy(raw: unknown): PasskeyPolicy {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PASSKEY_POLICY, roles: {} };
  const parsed = PasskeyPolicySchema.safeParse({ ...DEFAULT_PASSKEY_POLICY, ...(raw as object) });
  if (parsed.success) return parsed.data;
  return { ...DEFAULT_PASSKEY_POLICY, roles: {} };
}

export async function getPasskeyPolicy(siteId: string): Promise<PasskeyPolicy> {
  try {
    return normalizePasskeyPolicy(await getSiteSetting(siteId, PASSKEY_POLICY_SETTING_KEY));
  } catch {
    return { ...DEFAULT_PASSKEY_POLICY, roles: {} };
  }
}

export async function savePasskeyPolicy(siteId: string, policy: PasskeyPolicy): Promise<PasskeyPolicy> {
  const normalized = PasskeyPolicySchema.parse(policy);
  await setSiteSetting(siteId, PASSKEY_POLICY_SETTING_KEY, normalized);
  return normalized;
}

export function modeForRole(policy: PasskeyPolicy, role: string): PasskeyRoleMode {
  return policy.roles[role] ?? policy.defaultMode;
}

export interface RelyingParty {
  rpId: string;
  /** The origin this request was made from, which a challenge is bound to. */
  origin: string;
  /** Every origin a response may come from. */
  origins: string[];
}

/** True when `host` is `rpId` itself or a subdomain of it. */
export function hostWithinRpId(host: string, rpId: string): boolean {
  return host === rpId || host.endsWith(`.${rpId}`);
}

/**
 * The relying party for a request. `hostname` and `host` come from Express,
 * which honours X-Forwarded-Host and -Proto only from trusted proxies
 * (`TRUST_PROXY`), so behind a reverse proxy this is the address the browser
 * used. A configured RP ID that the current host is not within is ignored:
 * the browser would refuse it anyway, and a wrong setting must not be the
 * reason nobody can sign in.
 */
export function resolveRelyingParty(
  policy: PasskeyPolicy,
  request: { protocol: string; hostname: string; host: string },
): RelyingParty {
  const hostname = request.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const origin = `${request.protocol}://${request.host.toLowerCase()}`;
  const rpId = policy.rpId && hostWithinRpId(hostname, policy.rpId) ? policy.rpId : hostname;
  const origins = [origin, ...policy.extraOrigins.filter((extra) => {
    try {
      return hostWithinRpId(new URL(extra).hostname, rpId);
    } catch {
      return false;
    }
  })];
  return { rpId, origin, origins: [...new Set(origins)] };
}
