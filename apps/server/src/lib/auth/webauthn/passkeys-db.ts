// SPDX-License-Identifier: MIT

import { randomBytes, randomUUID } from "node:crypto";
import { getDb } from "../../database/db.js";
import { sha256, toBase64Url } from "./webauthn.js";

/**
 * Storage for passkeys and their ceremonies (#105).
 *
 * Credentials belong to an account's home site (`users.site_id`), so a shared
 * workspace account has one set of passkeys wherever it signs in. Challenges are
 * single-use: claiming one deletes it, and only the worker whose DELETE removed
 * the row may continue.
 */

/** How long a browser has to answer a challenge. WebAuthn's own timeout is shorter. */
export const CHALLENGE_TTL_MS = 5 * 60_000;
/** How many passkeys one account may hold. */
export const MAX_PASSKEYS_PER_USER = 20;

export type CeremonyPurpose = "register" | "login" | "second" | "confirm";

function sqlTime(date = new Date()): string {
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function toIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(" ", "T") + (String(value).includes("Z") || String(value).includes("+") ? "" : "Z"));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function credentialHash(credentialId: string): string {
  return sha256(Buffer.from(credentialId, "base64url")).toString("hex");
}

export interface Challenge {
  id: string;
  challenge: string;
}

export interface ClaimedChallenge {
  siteId: string;
  userId: string | null;
  purpose: CeremonyPurpose;
  challenge: string;
  rpId: string;
  origin: string;
}

export async function createChallenge(input: {
  siteId: string;
  userId: string | null;
  purpose: CeremonyPurpose;
  rpId: string;
  origin: string;
}): Promise<Challenge> {
  const db = await getDb();
  /** Expired rows are swept here rather than by a job: issuing is rare and cheap. */
  await db.run("DELETE FROM webauthn_challenges WHERE expires_at < ?", [sqlTime()]).catch(() => undefined);
  const id = randomBytes(32).toString("hex");
  const challenge = toBase64Url(randomBytes(32));
  await db.run(
    `INSERT INTO webauthn_challenges (id, site_id, user_id, purpose, challenge, rp_id, origin, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.siteId, input.userId, input.purpose, challenge, input.rpId.slice(0, 253), input.origin.slice(0, 300), sqlTime(new Date(Date.now() + CHALLENGE_TTL_MS))],
  );
  return { id, challenge };
}

/** Take a challenge out of circulation. Null when it is unknown, used, expired, or for something else. */
export async function claimChallenge(id: string, siteId: string, purpose: CeremonyPurpose): Promise<ClaimedChallenge | null> {
  if (!/^[0-9a-f]{64}$/.test(id)) return null;
  const db = await getDb();
  const rows = await db.query<{ site_id: string; user_id: string | null; purpose: string; challenge: string; rp_id: string; origin: string; expires_at: unknown }>(
    "SELECT site_id, user_id, purpose, challenge, rp_id, origin, expires_at FROM webauthn_challenges WHERE id = ? LIMIT 1",
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  const deleted = await db.execute("DELETE FROM webauthn_challenges WHERE id = ?", [id]);
  if (deleted !== 1) return null;
  const expires = toIso(row.expires_at);
  if (!expires || Date.parse(expires) < Date.now()) return null;
  if (String(row.site_id) !== siteId || row.purpose !== purpose) return null;
  return {
    siteId: String(row.site_id),
    userId: row.user_id == null ? null : String(row.user_id),
    purpose,
    challenge: String(row.challenge),
    rpId: String(row.rp_id),
    origin: String(row.origin),
  };
}

export interface PasskeyRow {
  id: string;
  userId: string;
  siteId: string;
  credentialId: string;
  publicKey: string;
  algorithm: number;
  signCount: number;
  transports: string[];
  aaguid: string | null;
  attestationFormat: string;
  backupEligible: boolean;
  backupState: boolean;
  name: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

const COLUMNS = `id, user_id, site_id, credential_id, public_key, algorithm, sign_count, transports, aaguid,
  attestation_format, backup_eligible, backup_state, name, created_at, last_used_at`;

function mapRow(row: Record<string, unknown>): PasskeyRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    siteId: String(row.site_id),
    credentialId: String(row.credential_id),
    publicKey: String(row.public_key),
    algorithm: Number(row.algorithm),
    signCount: Number(row.sign_count ?? 0),
    transports: String(row.transports ?? "").split(",").filter(Boolean),
    aaguid: row.aaguid == null ? null : String(row.aaguid),
    attestationFormat: String(row.attestation_format ?? "none"),
    backupEligible: row.backup_eligible === true || Number(row.backup_eligible) === 1,
    backupState: row.backup_state === true || Number(row.backup_state) === 1,
    name: String(row.name ?? ""),
    createdAt: toIso(row.created_at),
    lastUsedAt: toIso(row.last_used_at),
  };
}

export async function listPasskeys(userId: string, siteId: string): Promise<PasskeyRow[]> {
  const db = await getDb();
  const rows = await db.query<Record<string, unknown>>(
    `SELECT ${COLUMNS} FROM webauthn_credentials WHERE user_id = ? AND site_id = ? ORDER BY created_at, id LIMIT ${MAX_PASSKEYS_PER_USER * 2}`,
    [userId, siteId],
  );
  return rows.map(mapRow);
}

export async function countPasskeys(userId: string, siteId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.query<{ total: unknown }>(
    "SELECT COUNT(*) AS total FROM webauthn_credentials WHERE user_id = ? AND site_id = ?",
    [userId, siteId],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | null> {
  const db = await getDb();
  const rows = await db.query<Record<string, unknown>>(
    `SELECT ${COLUMNS} FROM webauthn_credentials WHERE credential_hash = ? LIMIT 1`,
    [credentialHash(credentialId)],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export interface NewPasskey {
  userId: string;
  siteId: string;
  credentialId: string;
  publicKey: string;
  algorithm: number;
  signCount: number;
  transports: string[];
  aaguid: string;
  attestationFormat: string;
  backupEligible: boolean;
  backupState: boolean;
  name: string;
}

/** Store a verified credential. Returns null when that credential is already registered. */
export async function insertPasskey(input: NewPasskey): Promise<string | null> {
  const db = await getDb();
  const id = randomUUID();
  const now = sqlTime();
  try {
    await db.run(
      `INSERT INTO webauthn_credentials
        (id, user_id, site_id, credential_hash, credential_id, public_key, algorithm, sign_count, transports, aaguid,
         attestation_format, backup_eligible, backup_state, name, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.userId, input.siteId, credentialHash(input.credentialId), input.credentialId, input.publicKey, input.algorithm,
        input.signCount, input.transports.join(",").slice(0, 255) || null, input.aaguid, input.attestationFormat.slice(0, 32),
        input.backupEligible, input.backupState, input.name.slice(0, 100), now, null],
    );
  } catch (err) {
    if (await findPasskeyByCredentialId(input.credentialId).catch(() => null)) return null;
    throw err;
  }
  return id;
}

/**
 * Record a successful use. The counter only moves forward: a second worker
 * presenting the same counter value updates nothing and is refused.
 */
export async function recordPasskeyUse(passkey: PasskeyRow, signCount: number, backupState: boolean): Promise<boolean> {
  const db = await getDb();
  const updated = await db.execute(
    `UPDATE webauthn_credentials SET sign_count = ?, backup_state = ?, last_used_at = ?
      WHERE id = ? AND sign_count = ?`,
    [signCount, backupState, sqlTime(), passkey.id, passkey.signCount],
  );
  return updated === 1 || (signCount === 0 && passkey.signCount === 0);
}

export async function renamePasskey(id: string, userId: string, siteId: string, name: string): Promise<boolean> {
  const db = await getDb();
  return (await db.execute(
    "UPDATE webauthn_credentials SET name = ? WHERE id = ? AND user_id = ? AND site_id = ?",
    [name.slice(0, 100), id, userId, siteId],
  )) === 1;
}

export async function deletePasskey(id: string, userId: string, siteId: string): Promise<boolean> {
  const db = await getDb();
  return (await db.execute(
    "DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ? AND site_id = ?",
    [id, userId, siteId],
  )) === 1;
}

export async function deleteAllPasskeys(userId: string, siteId: string): Promise<number> {
  const db = await getDb();
  return db.execute("DELETE FROM webauthn_credentials WHERE user_id = ? AND site_id = ?", [userId, siteId]);
}

/**
 * After a passkey is removed: recovery codes back up second factors, so once
 * the account has neither a passkey nor a confirmed authenticator app they are
 * dropped rather than left as a password-equivalent nobody needs.
 */
export async function clearPasskeyDependants(userId: string, siteId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE users SET totp_recovery_codes = NULL
      WHERE id = ? AND site_id = ? AND totp_confirmed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM webauthn_credentials w WHERE w.user_id = ? AND w.site_id = ?)`,
    [userId, siteId, userId, siteId],
  );
}
