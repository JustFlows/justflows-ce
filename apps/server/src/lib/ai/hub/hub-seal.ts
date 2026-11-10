// SPDX-License-Identifier: MIT

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { hubSecret } from "./hub-config.js";

/**
 * Sealed hub values: client ids, pending requests, authorization codes and
 * tokens. The hub stores none of them. Each is AES-256-GCM encrypted under a
 * key derived for its purpose, so a value sealed for one purpose (an access
 * token) can never be opened as another (a refresh token).
 */
export type SealPurpose = "client" | "request" | "flow" | "code" | "access" | "refresh";

const PREFIX: Record<SealPurpose, string> = {
  client: "jfhc_",
  request: "jfhq_",
  flow: "jfhf_",
  code: "jfhk_",
  access: "jfha_",
  refresh: "jfhr_",
};

function keyFor(purpose: SealPurpose): Buffer {
  return Buffer.from(hkdfSync("sha256", hubSecret(), "justflows-mcp-hub", `seal:${purpose}`, 32));
}

/**
 * Seal `payload` for `purpose`. With `ttlSeconds` the value stops opening
 * after that many seconds; without it, it never expires.
 */
export function seal(purpose: SealPurpose, payload: Record<string, unknown>, ttlSeconds?: number): string {
  const body = { ...payload, ...(ttlSeconds ? { exp: Date.now() + ttlSeconds * 1000 } : {}) };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(purpose), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final()]);
  const packed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  return `${PREFIX[purpose]}${packed}`;
}

/** Open a sealed value. Null when it is malformed, tampered with, for another purpose, or expired. */
export function open<T extends Record<string, unknown>>(purpose: SealPurpose, value: unknown): T | null {
  if (typeof value !== "string" || !value.startsWith(PREFIX[purpose]) || value.length > 16_384) return null;
  try {
    const raw = Buffer.from(value.slice(PREFIX[purpose].length), "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFor(purpose), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as T & { exp?: unknown };
    if (typeof record.exp === "number" && record.exp < Date.now()) return null;
    return record;
  } catch {
    return null;
  }
}
