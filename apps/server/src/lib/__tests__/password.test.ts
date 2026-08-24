import { describe, expect, it } from "vitest";
import {
  ITERATIONS,
  hashPassword,
  needsRehash,
  parsePasswordHash,
  verifyPassword,
} from "../password.js";

describe("hashPassword / verifyPassword", () => {
  it("round-trips", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("salts, so the same password hashes differently each time", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("records the work factor it used", async () => {
    expect(parsePasswordHash(await hashPassword("x"))?.iterations).toBe(ITERATIONS);
  });
});

describe("parsePasswordHash", () => {
  it("reads the iteration count from the hash rather than assuming it", () => {
    const parsed = parsePasswordHash("$pbkdf2$310000$abc$def");
    expect(parsed).toEqual({ iterations: 310000, salt: "abc", digest: "def" });
  });

  it("rejects malformed and hostile hashes", () => {
    for (const bad of [
      "",
      "plain",
      "$bcrypt$10$abc$def",
      "$pbkdf2$abc$salt$digest",
      "$pbkdf2$0$salt$digest",
      "$pbkdf2$99999999999$salt$digest", // would hang the process
      "$pbkdf2$310000$$digest",
    ]) {
      expect(parsePasswordHash(bad), bad).toBeNull();
    }
  });
});

describe("verifyPassword against an older work factor", () => {
  // The point of reading iterations from the hash: raising the constant must not
  // lock out every existing user.
  const legacy = "$pbkdf2$310000$4f0e1c2b3a4d5e6f$";

  it("still verifies a hash minted at the old cost", async () => {
    const { pbkdf2 } = await import("node:crypto");
    const { promisify } = await import("node:util");
    const derive = promisify(pbkdf2);
    const salt = "4f0e1c2b3a4d5e6f";
    const key = (await derive("legacy-password", salt, 310_000, 32, "sha256")) as Buffer;
    const stored = `${legacy}${key.toString("hex")}`;

    expect(await verifyPassword("legacy-password", stored)).toBe(true);
    expect(await verifyPassword("nope", stored)).toBe(false);
  });

  it("flags it for upgrade", () => {
    expect(needsRehash("$pbkdf2$310000$abc$def")).toBe(true);
    expect(needsRehash(`$pbkdf2$${ITERATIONS}$abc$def`)).toBe(false);
    expect(needsRehash("garbage")).toBe(true);
  });
});
