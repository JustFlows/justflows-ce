// SPDX-License-Identifier: MIT

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Authenticated encryption for secrets held in site_settings.
 *
 * This does not defend against a compromised server — the key is derived from
 * APP_SECRET, which that attacker already has. It defends against the cases that
 * actually happen: a database backup handed to a contractor, a read-only SQL
 * injection, a support export. Those should not hand over a working mail
 * credential in plaintext.
 *
 * Format: `enc:v1:<iv-b64url>:<tag-b64url>:<ciphertext-b64url>`
 */
const PREFIX = "enc:v1:";
const IV_BYTES = 12;

function key(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("APP_SECRET must be at least 32 characters");
  }
  // Domain-separated so this key is never the same as the session or CSRF key.
  return Buffer.from(hkdfSync("sha256", secret, "justflows-secret-box", "site-settings", 32));
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return (
    PREFIX +
    [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64url")).join(":")
  );
}

/**
 * Decrypt a value produced by encryptSecret.
 *
 * A value without the prefix is returned unchanged: settings written before this
 * existed are plaintext, and they re-encrypt on the next save rather than
 * needing a migration. Returns "" if the ciphertext fails authentication, so a
 * tampered row cannot silently become a different credential.
 */
export function decryptSecret(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  if (!isEncrypted(value)) return value;

  const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(":");
  if (!ivB64 || !tagB64 || !dataB64) return "";

  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    console.error("[justflows] a stored secret could not be decrypted (wrong APP_SECRET, or tampered)");
    return "";
  }
}
