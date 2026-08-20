import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ITERATIONS = 310_000;
const KEY_LEN = 32;
const DIGEST = "sha256";

/** Bcrypt-style PBKDF2 hash stored as `$pbkdf2$iter$salt$hash` */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await pbkdf2(password, salt);
  return `$pbkdf2$${ITERATIONS}$${salt}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  // [$, pbkdf2, iter, salt, hash]
  if (parts.length !== 5 || parts[1] !== "pbkdf2") return false;
  const salt = parts[3] as string;
  const expected = parts[4] as string;
  const actual = await pbkdf2(password, salt);
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function pbkdf2(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { pbkdf2: nodePbkdf2 } = require("node:crypto") as typeof import("node:crypto");
    nodePbkdf2(password, salt, ITERATIONS, KEY_LEN, DIGEST, (err, key) => {
      if (err) reject(err);
      else resolve(key.toString("hex"));
    });
  });
}

export function generateToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}
