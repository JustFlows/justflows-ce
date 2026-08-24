import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncrypted } from "../secret-box.js";

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";
});

describe("secret box", () => {
  it("round-trips", () => {
    const secret = "hunter2-smtp-p@ssw0rd";
    const box = encryptSecret(secret);
    expect(box).not.toContain(secret);
    expect(isEncrypted(box)).toBe(true);
    expect(decryptSecret(box)).toBe(secret);
  });

  it("produces a different ciphertext each time", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("passes plaintext through, so pre-0.1.2 settings keep working", () => {
    expect(decryptSecret("legacy-plaintext")).toBe("legacy-plaintext");
    expect(isEncrypted("legacy-plaintext")).toBe(false);
  });

  it("returns empty rather than garbage when the ciphertext is tampered with", () => {
    const box = encryptSecret("secret");
    const parts = box.split(":");
    parts[4] = Buffer.from("tampered").toString("base64url");
    expect(decryptSecret(parts.join(":"))).toBe("");
  });

  it("returns empty when the auth tag is wrong", () => {
    const parts = encryptSecret("secret").split(":");
    parts[3] = Buffer.alloc(16).toString("base64url");
    expect(decryptSecret(parts.join(":"))).toBe("");
  });

  it("handles empty and malformed input", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
    expect(decryptSecret(undefined)).toBe("");
    expect(decryptSecret("enc:v1:broken")).toBe("");
  });
});
