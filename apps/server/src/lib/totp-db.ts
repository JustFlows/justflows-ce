// SPDX-License-Identifier: MIT

import { getDb } from "./db.js";
import { decryptSecret, encryptSecret } from "./secret-box.js";
import { matchRecoveryCode } from "./totp.js";

/**
 * Storage for two-factor enrolment.
 *
 * Secrets and recovery codes are encrypted at rest with secret-box — the same
 * reasoning as mail credentials: this does not defend against a compromised
 * server, which already holds APP_SECRET, but a database backup, a read-only
 * injection or a support export should not hand over working seeds.
 *
 * Every read is written so a pre-0007 schema behaves as "not enrolled" rather
 * than throwing, so a site whose migration has not run yet still signs in.
 */

export interface TotpState {
  /** Enrolment started but not yet proven. */
  pending: boolean;
  /** Enrolment confirmed — a code is required at sign-in. */
  enabled: boolean;
  secret: string | null;
  recoveryCodes: string[];
}

interface TotpRow {
  totp_secret: string | null;
  totp_confirmed_at: string | Date | null;
  totp_recovery_codes: string | null;
}

const NOT_ENROLLED: TotpState = { pending: false, enabled: false, secret: null, recoveryCodes: [] };

function parseCodes(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const decrypted = decryptSecret(raw);
    const parsed = JSON.parse(decrypted || "[]");
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

/** Current enrolment for a user, or NOT_ENROLLED when the columns are absent. */
export async function getTotpState(userId: string, siteId: string): Promise<TotpState> {
  try {
    const db = await getDb();
    const rows = await db.query<TotpRow>(
      "SELECT totp_secret, totp_confirmed_at, totp_recovery_codes FROM users WHERE id = ? AND site_id = ? LIMIT 1",
      [userId, siteId],
    );
    const row = rows[0];
    if (!row?.totp_secret) return NOT_ENROLLED;

    const secret = decryptSecret(row.totp_secret);
    if (!secret) return NOT_ENROLLED;

    return {
      pending: !row.totp_confirmed_at,
      enabled: Boolean(row.totp_confirmed_at),
      secret,
      recoveryCodes: parseCodes(row.totp_recovery_codes),
    };
  } catch {
    // 0007_totp has not been applied. Two-factor is unavailable until it is;
    // failing closed here would lock every user out of a working site.
    return NOT_ENROLLED;
  }
}

/** Begin enrolment. Not in force until confirmTotp. */
export async function startTotpEnrolment(
  userId: string,
  siteId: string,
  secret: string,
): Promise<void> {
  const db = await getDb();
  await db.run(
    "UPDATE users SET totp_secret = ?, totp_confirmed_at = NULL, totp_recovery_codes = NULL WHERE id = ? AND site_id = ?",
    [encryptSecret(secret), userId, siteId],
  );
}

/** Mark enrolment proven and store the recovery codes. */
export async function confirmTotp(
  userId: string,
  siteId: string,
  recoveryCodes: string[],
  confirmedAt: string,
): Promise<void> {
  const db = await getDb();
  await db.run(
    "UPDATE users SET totp_confirmed_at = ?, totp_recovery_codes = ? WHERE id = ? AND site_id = ?",
    [confirmedAt, encryptSecret(JSON.stringify(recoveryCodes)), userId, siteId],
  );
}

export async function disableTotp(userId: string, siteId: string): Promise<void> {
  const db = await getDb();
  await db.run(
    "UPDATE users SET totp_secret = NULL, totp_confirmed_at = NULL, totp_recovery_codes = NULL WHERE id = ? AND site_id = ?",
    [userId, siteId],
  );
}

/**
 * Spend a recovery code.
 *
 * Returns true when the code was valid; the code is removed in the same call,
 * so each is good exactly once. A code that could be replayed is a password
 * with extra steps.
 */
export async function consumeRecoveryCode(
  userId: string,
  siteId: string,
  supplied: string,
): Promise<boolean> {
  const state = await getTotpState(userId, siteId);
  if (!state.enabled || state.recoveryCodes.length === 0) return false;

  const index = matchRecoveryCode(state.recoveryCodes, supplied);
  if (index === -1) return false;

  const remaining = state.recoveryCodes.filter((_, i) => i !== index);
  const db = await getDb();
  await db.run("UPDATE users SET totp_recovery_codes = ? WHERE id = ? AND site_id = ?", [
    encryptSecret(JSON.stringify(remaining)),
    userId,
    siteId,
  ]);
  return true;
}
