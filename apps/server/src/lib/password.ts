import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);

/** Current work factor (OWASP guidance for PBKDF2-HMAC-SHA256). */
export const ITERATIONS = 600_000;
const KEY_LEN = 32;

/** Refuse absurd costs from a malformed or hostile hash string. */
const MAX_ITERATIONS = 5_000_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await pbkdf2Async(password, salt, ITERATIONS, KEY_LEN, "sha256");
  return `$pbkdf2$${ITERATIONS}$${salt}$${key.toString("hex")}`;
}

export interface ParsedHash {
  iterations: number;
  salt: string;
  digest: string;
}

/**
 * Parse `$pbkdf2$<iterations>$<salt>$<hex>`.
 *
 * The iteration count is read from the hash rather than assumed. Verification
 * used to hardcode the constant, so raising it would have invalidated every
 * existing password — which is exactly the thing that stops work factors from
 * ever being raised.
 */
export function parsePasswordHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[1] !== "pbkdf2") return null;
  const iterations = Number.parseInt(parts[2] ?? "", 10);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return null;
  if (!parts[3] || !parts[4]) return null;
  return { iterations, salt: parts[3], digest: parts[4] };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;

  const key = await pbkdf2Async(password, parsed.salt, parsed.iterations, KEY_LEN, "sha256");
  const a = Buffer.from(key.toString("hex"), "utf-8");
  const b = Buffer.from(parsed.digest, "utf-8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when the stored hash is weaker than what we mint today. */
export function needsRehash(stored: string): boolean {
  const parsed = parsePasswordHash(stored);
  return parsed === null || parsed.iterations < ITERATIONS;
}
