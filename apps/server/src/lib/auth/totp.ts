// SPDX-License-Identifier: MIT

import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * RFC 6238 TOTP, on Node builtins.
 *
 * No dependency: the algorithm is thirty lines, and adding a package to the
 * authentication path is a supply-chain decision, not a convenience one.
 *
 * SHA-1 is not a weakness here — HOTP/TOTP use HMAC, which does not rely on
 * collision resistance, and every authenticator app expects it.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

/**
 * How far either side of now a code is accepted.
 *
 * One step (±30s) absorbs ordinary clock drift between the server and the
 * phone. Wider would be friendlier and would also widen the window in which a
 * code shoulder-surfed off a screen still works.
 */
export const TOTP_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character in TOTP secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret, the size RFC 4226 recommends for HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code for one time step. */
export function totpCode(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", key).update(buf).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * Whether `token` is valid for `secret` right now.
 *
 * Every candidate is compared, and always with timingSafeEqual, rather than
 * returning on the first match — so the time taken does not reveal which step
 * matched, or whether any did.
 */
export function verifyTotp(secret: string, token: string, atMs = Date.now()): boolean {
  const cleaned = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;

  const counter = Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
  const supplied = Buffer.from(cleaned);
  let matched = false;

  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift++) {
    let expected: Buffer;
    try {
      expected = Buffer.from(totpCode(secret, counter + drift));
    } catch {
      return false;
    }
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) {
      matched = true;
    }
  }
  return matched;
}

/** otpauth:// URI for an authenticator app's QR code. */
export function totpUri(secret: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export const RECOVERY_CODE_COUNT = 10;

/**
 * Single-use codes for a lost phone.
 *
 * Without these, losing the authenticator means losing the account — which is
 * how MFA turns into a support burden and then gets switched off. Generated
 * with randomInt (CSPRNG), formatted in two groups so they can be read aloud.
 */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let code = "";
    for (let c = 0; c < 10; c++) {
      if (c === 5) code += "-";
      code += alphabet[randomInt(alphabet.length)];
    }
    codes.push(code);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Constant-time membership test that reports which entry matched. */
export function matchRecoveryCode(codes: string[], supplied: string): number {
  const target = Buffer.from(normalizeRecoveryCode(supplied));
  let found = -1;
  for (let i = 0; i < codes.length; i++) {
    const candidate = Buffer.from(normalizeRecoveryCode(codes[i]!));
    if (candidate.length === target.length && timingSafeEqual(candidate, target)) {
      found = i;
    }
  }
  return found;
}
