// SPDX-License-Identifier: MIT

import { getDb } from "../database/db.js";
import { decryptSecret, encryptSecret } from "../security/secret-box.js";
import { matchRecoveryCode } from "./totp.js";

/**
 * Storage for two-factor enrolment.
 *
 * Secrets and recovery codes are encrypted at rest with secret-box. A row that
 * cannot be read — a database error, a wrong encryption key, or a corrupt
 * blob — is not "not enrolled". Callers must refuse the sign-in and must not
 * overwrite that factor.
 */

export class TotpUnavailableError extends Error {
  constructor() {
    super("Two-factor state cannot be read");
    this.name = "TotpUnavailableError";
  }
}

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

function parseCodes(raw: string | null): string[] | null {
  if (raw == null || raw === "") return [];
  const decrypted = decryptSecret(raw);
  if (!decrypted) return null;
  try {
    const parsed = JSON.parse(decrypted);
    if (!Array.isArray(parsed) || parsed.some((code) => typeof code !== "string")) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Current enrolment. Throws when the factor exists but cannot be trusted. */
export async function getTotpState(userId: string, siteId: string): Promise<TotpState> {
  let rows: TotpRow[];
  try {
    const db = await getDb();
    rows = await db.query<TotpRow>(
      "SELECT totp_secret, totp_confirmed_at, totp_recovery_codes FROM users WHERE id = ? AND site_id = ? LIMIT 1",
      [userId, siteId],
    );
  } catch {
    throw new TotpUnavailableError();
  }
  const row = rows[0];
  if (!row) throw new TotpUnavailableError();

  const storedSecret = row.totp_secret == null ? "" : String(row.totp_secret);
  const confirmed = Boolean(row.totp_confirmed_at);
  if (!storedSecret && confirmed) throw new TotpUnavailableError();
  if (!storedSecret) return NOT_ENROLLED;

  const secret = decryptSecret(storedSecret);
  if (!secret) throw new TotpUnavailableError();
  const recoveryCodes = parseCodes(row.totp_recovery_codes);
  if (!recoveryCodes) throw new TotpUnavailableError();

  return {
    pending: !confirmed,
    enabled: confirmed,
    secret,
    recoveryCodes,
  };
}

/**
 * Begin enrolment. Refuses to replace a factor that is already confirmed.
 * Returns false when no row changed.
 */
export async function startTotpEnrolment(
  userId: string,
  siteId: string,
  secret: string,
): Promise<boolean> {
  const db = await getDb();
  const updated = await db.execute(
    `UPDATE users SET totp_secret = ?, totp_confirmed_at = NULL, totp_recovery_codes = NULL
      WHERE id = ? AND site_id = ? AND totp_confirmed_at IS NULL`,
    [encryptSecret(secret), userId, siteId],
  );
  return updated === 1;
}

/**
 * Mark enrolment proven, store the recovery codes, and claim the step that
 * proved it. Returns false when the pending factor was no longer writable.
 */
export async function confirmTotp(
  userId: string,
  siteId: string,
  recoveryCodes: string[],
  confirmedAt: string,
  step: number,
): Promise<boolean> {
  const db = await getDb();
  const updated = await db.execute(
    `UPDATE users
        SET totp_confirmed_at = ?, totp_recovery_codes = ?, totp_last_step = ?
      WHERE id = ? AND site_id = ? AND totp_confirmed_at IS NULL AND totp_secret IS NOT NULL`,
    [confirmedAt, encryptSecret(JSON.stringify(recoveryCodes)), step, userId, siteId],
  );
  return updated === 1;
}

/** Clear a factor that is still in the state the caller just authorized. */
export async function disableTotp(userId: string, siteId: string, enabled: boolean): Promise<boolean> {
  const db = await getDb();
  const updated = await db.execute(
    `UPDATE users
        SET totp_secret = NULL, totp_confirmed_at = NULL, totp_recovery_codes = NULL, totp_last_step = NULL
      WHERE id = ? AND site_id = ? AND totp_confirmed_at IS ${enabled ? "NOT NULL" : "NULL"}`,
    [userId, siteId],
  );
  return updated === 1;
}

/**
 * Claim one authenticator step. A second worker that presents the same step
 * updates zero rows and must not receive a session.
 */
export async function claimTotpStep(userId: string, siteId: string, step: number): Promise<boolean> {
  const db = await getDb();
  const updated = await db.execute(
    `UPDATE users SET totp_last_step = ?
      WHERE id = ? AND site_id = ? AND totp_confirmed_at IS NOT NULL
        AND (totp_last_step IS NULL OR totp_last_step < ?)`,
    [step, userId, siteId, step],
  );
  return updated === 1;
}

/**
 * Spend one recovery code without restoring a code another worker just spent.
 *
 * The write matches the ciphertext that was read. A lost race reads again and
 * removes only the code that is still present.
 */
export async function consumeRecoveryCode(
  userId: string,
  siteId: string,
  supplied: string,
): Promise<boolean> {
  const db = await getDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await db.query<TotpRow>(
      "SELECT totp_secret, totp_confirmed_at, totp_recovery_codes FROM users WHERE id = ? AND site_id = ? LIMIT 1",
      [userId, siteId],
    );
    const row = rows[0];
    if (!row?.totp_confirmed_at) return false;
    const codes = parseCodes(row.totp_recovery_codes);
    if (!codes) throw new TotpUnavailableError();
    const index = matchRecoveryCode(codes, supplied);
    if (index === -1) return false;

    const remaining = codes.filter((_, i) => i !== index);
    const next = encryptSecret(JSON.stringify(remaining));
    const previous = row.totp_recovery_codes ?? "";
    const updated = await db.execute(
      "UPDATE users SET totp_recovery_codes = ? WHERE id = ? AND site_id = ? AND totp_recovery_codes = ?",
      [next, userId, siteId, previous],
    );
    if (updated === 1) return true;
  }
  return false;
}
