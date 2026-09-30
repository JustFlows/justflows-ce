import { createHash, createHmac, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertCoreUpdateIsTrusted,
  coreReleaseSignPayload,
  verifyCoreReleaseSignature,
} from "../../../src/lib/extensions/package-trust.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const other = generateKeyPairSync("ed25519");
const OTHER_PEM = other.publicKey.export({ type: "spki", format: "pem" }).toString();

const buffer = Buffer.from("pretend this is justflows.zip");
const digest = createHash("sha256").update(buffer).digest("hex");

function releaseSig(version: string, d = digest, key = privateKey): string {
  return sign(null, coreReleaseSignPayload(version, d), key).toString("base64");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("verifyCoreReleaseSignature", () => {
  it("accepts a signature over this version and digest", () => {
    expect(verifyCoreReleaseSignature(digest, "0.3.0", releaseSig("0.3.0"), [PUBLIC_PEM])).toBe(
      true,
    );
  });

  it("accepts any key in the list, so a key can be rotated", () => {
    expect(
      verifyCoreReleaseSignature(digest, "0.3.0", releaseSig("0.3.0"), [OTHER_PEM, PUBLIC_PEM]),
    ).toBe(true);
  });

  it("rejects a signed older build relabelled as a newer version", () => {
    expect(verifyCoreReleaseSignature(digest, "0.3.1", releaseSig("0.3.0"), [PUBLIC_PEM])).toBe(
      false,
    );
  });

  it("rejects a different archive, an unknown key, and garbage", () => {
    const otherDigest = "a".repeat(64);
    expect(
      verifyCoreReleaseSignature(otherDigest, "0.3.0", releaseSig("0.3.0"), [PUBLIC_PEM]),
    ).toBe(false);
    expect(verifyCoreReleaseSignature(digest, "0.3.0", releaseSig("0.3.0"), [OTHER_PEM])).toBe(
      false,
    );
    expect(verifyCoreReleaseSignature(digest, "0.3.0", "not base64!", [PUBLIC_PEM])).toBe(false);
    expect(verifyCoreReleaseSignature(digest, "0.3.0", undefined, [PUBLIC_PEM])).toBe(false);
    expect(verifyCoreReleaseSignature(digest, "0.3.0", releaseSig("0.3.0"), [])).toBe(false);
  });
});

describe("assertCoreUpdateIsTrusted", () => {
  const base = { buffer, digest, version: "0.3.0" };

  it("refuses an unsigned archive by default", () => {
    expect(() => assertCoreUpdateIsTrusted(base, [PUBLIC_PEM])).toThrow(
      /could not be verified[\s\S]*JUSTFLOWS_UPDATE_DIGEST=/,
    );
  });

  it("applies an official release with a valid signature", () => {
    expect(
      assertCoreUpdateIsTrusted({ ...base, releaseSignature: releaseSig("0.3.0") }, [PUBLIC_PEM]),
    ).toMatch(/release signature verified/);
  });

  it("refuses a release signature that does not match, even with the opt-out set", () => {
    vi.stubEnv("JUSTFLOWS_ALLOW_UNSIGNED_CORE_UPDATES", "1");
    expect(() =>
      assertCoreUpdateIsTrusted({ ...base, releaseSignature: releaseSig("0.2.9") }, [PUBLIC_PEM]),
    ).toThrow(/does not match this archive/);
  });

  it("accepts a pinned digest and refuses any other archive while pinned", () => {
    vi.stubEnv("JUSTFLOWS_UPDATE_DIGEST", digest.toUpperCase());
    expect(assertCoreUpdateIsTrusted(base, [PUBLIC_PEM])).toMatch(/JUSTFLOWS_UPDATE_DIGEST/);

    vi.stubEnv("JUSTFLOWS_UPDATE_DIGEST", "b".repeat(64));
    expect(() =>
      assertCoreUpdateIsTrusted({ ...base, releaseSignature: releaseSig("0.3.0") }, [PUBLIC_PEM]),
    ).toThrow(/does not match JUSTFLOWS_UPDATE_DIGEST/);
  });

  it("accepts an operator HMAC, and an official release without one", () => {
    vi.stubEnv("JUSTFLOWS_UPDATE_SIGNING_KEY", "operator-key");
    const hmac = createHmac("sha256", "operator-key").update(buffer).digest("hex");
    expect(assertCoreUpdateIsTrusted({ ...base, signature: hmac }, [PUBLIC_PEM])).toMatch(
      /JUSTFLOWS_UPDATE_SIGNING_KEY/,
    );
    expect(() => assertCoreUpdateIsTrusted({ ...base, signature: "00" }, [PUBLIC_PEM])).toThrow(
      /signature is invalid/,
    );
    expect(
      assertCoreUpdateIsTrusted({ ...base, releaseSignature: releaseSig("0.3.0") }, [PUBLIC_PEM]),
    ).toMatch(/release signature verified/);
  });

  it("lets an operator opt out, with a warning", () => {
    vi.stubEnv("JUSTFLOWS_ALLOW_UNSIGNED_CORE_UPDATES", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(assertCoreUpdateIsTrusted(base, [PUBLIC_PEM])).toMatch(/Unverified/);
    expect(warn).toHaveBeenCalledOnce();
  });
});
