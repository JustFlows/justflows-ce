// SPDX-License-Identifier: MIT

import type { Request } from "express";
import { z } from "zod";
import { getDb } from "../../database/db.js";
import { getPasskeyPolicy, modeForRole, resolveRelyingParty, type PasskeyPolicy, type RelyingParty } from "./passkey-policy.js";
import { claimChallenge, createChallenge, findPasskeyByCredentialId, listPasskeys, recordPasskeyUse, type CeremonyPurpose, type PasskeyRow } from "./passkeys-db.js";
import { SUPPORTED_ALGORITHMS, WebAuthnError, userHandleFor, verifyAuthentication, type AuthenticationResponse } from "./webauthn.js";

/**
 * Request-level glue between Express and the WebAuthn verifier: which relying
 * party a request is for, the JSON options a browser needs, and the checks that
 * bind a response to the challenge it answers.
 */

/** How long the browser prompt stays open. */
export const CEREMONY_TIMEOUT_MS = 120_000;

export const CredentialJsonSchema = z.object({
  id: z.string().min(1).max(1400),
  rawId: z.string().min(1).max(1400),
  type: z.literal("public-key"),
  authenticatorAttachment: z.string().max(32).nullable().optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  response: z.object({
    clientDataJSON: z.string().min(1).max(8192),
    attestationObject: z.string().max(65_536).optional(),
    authenticatorData: z.string().max(8192).optional(),
    signature: z.string().max(2048).optional(),
    userHandle: z.string().max(128).nullable().optional(),
    transports: z.array(z.string().max(32)).max(10).optional(),
  }),
});
export type CredentialJson = z.infer<typeof CredentialJsonSchema>;

export const PasskeyAnswerSchema = z.object({
  ceremonyId: z.string().regex(/^[0-9a-f]{64}$/),
  credential: CredentialJsonSchema,
});
export type PasskeyAnswer = z.infer<typeof PasskeyAnswerSchema>;

export function relyingPartyFor(req: Request, policy: PasskeyPolicy): RelyingParty {
  return resolveRelyingParty(policy, { protocol: req.protocol, hostname: req.hostname, host: req.host ?? req.hostname });
}

/** The site an account's passkeys are stored under: its home site. */
export async function homeSiteOf(userId: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.query<{ site_id: string }>("SELECT site_id FROM users WHERE id = ? LIMIT 1", [userId]);
  return rows[0] ? String(rows[0].site_id) : null;
}

/**
 * The response must answer a challenge issued on this request's origin. The
 * origin recorded with the challenge is checked again here so a challenge minted
 * on one hostname cannot be completed on another that shares the database.
 */
export async function claimForRequest(
  req: Request,
  policy: PasskeyPolicy,
  ceremonyId: string,
  siteId: string,
  purpose: CeremonyPurpose,
) {
  const claimed = await claimChallenge(ceremonyId, siteId, purpose);
  if (!claimed) return null;
  const rp = relyingPartyFor(req, policy);
  if (claimed.rpId !== rp.rpId || claimed.origin !== rp.origin) return null;
  return { claimed, rp };
}

export function descriptor(passkey: PasskeyRow) {
  return { type: "public-key" as const, id: passkey.credentialId, ...(passkey.transports.length ? { transports: passkey.transports } : {}) };
}

export interface RequestOptionsJson {
  ceremonyId: string;
  publicKey: {
    challenge: string;
    rpId: string;
    timeout: number;
    userVerification: "required" | "preferred";
    allowCredentials: Array<ReturnType<typeof descriptor>>;
  };
}

/** Options for `navigator.credentials.get`. An empty allow-list asks for a discoverable passkey. */
export async function requestOptions(
  req: Request,
  policy: PasskeyPolicy,
  input: { siteId: string; userId: string | null; purpose: CeremonyPurpose; passkeys: PasskeyRow[]; userVerification: "required" | "preferred" },
): Promise<RequestOptionsJson> {
  const rp = relyingPartyFor(req, policy);
  const { id, challenge } = await createChallenge({ siteId: input.siteId, userId: input.userId, purpose: input.purpose, rpId: rp.rpId, origin: rp.origin });
  return {
    ceremonyId: id,
    publicKey: {
      challenge,
      rpId: rp.rpId,
      timeout: CEREMONY_TIMEOUT_MS,
      userVerification: input.userVerification,
      allowCredentials: input.passkeys.map(descriptor),
    },
  };
}

export function creationOptions(
  rp: RelyingParty,
  input: { ceremonyId: string; challenge: string; siteName: string; userId: string; email: string; displayName: string; policy: PasskeyPolicy; existing: PasskeyRow[] },
) {
  return {
    ceremonyId: input.ceremonyId,
    publicKey: {
      rp: { id: rp.rpId, name: input.siteName },
      user: { id: userHandleFor(input.userId), name: input.email, displayName: input.displayName || input.email },
      challenge: input.challenge,
      pubKeyCredParams: SUPPORTED_ALGORITHMS.map((alg) => ({ type: "public-key" as const, alg })),
      timeout: CEREMONY_TIMEOUT_MS,
      attestation: input.policy.attestation,
      authenticatorSelection: {
        residentKey: "preferred" as const,
        requireResidentKey: false,
        userVerification: input.policy.userVerification,
      },
      excludeCredentials: input.existing.map(descriptor),
      extensions: { credProps: true },
    },
  };
}

export type PasskeyCheck =
  | { ok: true; passkey: PasskeyRow; userVerified: boolean }
  | { ok: false; reason: string; userId?: string };

/**
 * Verify a sign-in answer for a known account (passkey as a second factor, or a
 * re-confirmation). The challenge must have been issued to that account.
 */
export async function verifyPasskeyForAccount(
  req: Request,
  input: { requestSiteId: string; homeSiteId: string; userId: string; role: string; answer: PasskeyAnswer; purpose: CeremonyPurpose; requireUserVerification: boolean },
): Promise<PasskeyCheck> {
  const policy = await getPasskeyPolicy(input.requestSiteId);
  if (modeForRole(policy, input.role) === "disallow") return { ok: false, reason: "passkeys disallowed for role" };
  const claim = await claimForRequest(req, policy, input.answer.ceremonyId, input.requestSiteId, input.purpose);
  if (!claim || claim.claimed.userId !== input.userId) return { ok: false, reason: "unknown or expired challenge" };
  const passkey = await findPasskeyByCredentialId(input.answer.credential.rawId).catch(() => null);
  if (!passkey || passkey.userId !== input.userId || passkey.siteId !== input.homeSiteId) {
    return { ok: false, reason: "passkey not registered to this account" };
  }
  return checkAssertion(passkey, input.answer, claim, input.requireUserVerification || policy.userVerification === "required");
}

/** Verify a passwordless answer, where the passkey names the account. */
export async function verifyDiscoverablePasskey(
  req: Request,
  input: { requestSiteId: string; answer: PasskeyAnswer },
): Promise<PasskeyCheck> {
  const policy = await getPasskeyPolicy(input.requestSiteId);
  const claim = await claimForRequest(req, policy, input.answer.ceremonyId, input.requestSiteId, "login");
  if (!claim || claim.claimed.userId !== null) return { ok: false, reason: "unknown or expired challenge" };
  const passkey = await findPasskeyByCredentialId(input.answer.credential.rawId).catch(() => null);
  if (!passkey) return { ok: false, reason: "passkey not registered" };
  /** Passwordless is both factors, so it always needs a PIN or biometric. */
  return checkAssertion(passkey, input.answer, claim, true);
}

async function checkAssertion(
  passkey: PasskeyRow,
  answer: PasskeyAnswer,
  claim: NonNullable<Awaited<ReturnType<typeof claimForRequest>>>,
  requireUserVerification: boolean,
): Promise<PasskeyCheck> {
  try {
    const result = verifyAuthentication(
      answer.credential as unknown as AuthenticationResponse,
      { challenge: claim.claimed.challenge, origins: claim.rp.origins, rpId: claim.claimed.rpId, requireUserVerification },
      { publicKey: passkey.publicKey, signCount: passkey.signCount, userHandle: userHandleFor(passkey.userId) },
    );
    if (!(await recordPasskeyUse(passkey, result.signCount, result.backupState))) {
      return { ok: false, reason: "passkey counter race", userId: passkey.userId };
    }
    return { ok: true, passkey, userVerified: result.userVerified };
  } catch (err) {
    if (err instanceof WebAuthnError) return { ok: false, reason: `${err.code}: ${err.message}`, userId: passkey.userId };
    throw err;
  }
}

/** Passkeys that count for an account on this site: none when its role may not use them. */
export async function usablePasskeys(requestSiteId: string, homeSiteId: string, userId: string, role: string) {
  const policy = await getPasskeyPolicy(requestSiteId);
  const mode = modeForRole(policy, role);
  if (mode === "disallow") return { policy, mode, passkeys: [] as PasskeyRow[] };
  return { policy, mode, passkeys: await listPasskeys(userId, homeSiteId) };
}
