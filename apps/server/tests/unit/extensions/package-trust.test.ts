import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPackageIsTrusted } from "../../../src/lib/extensions/package-trust.js";

const manifest = { id: "acme.theme", version: "1.0.1", publisher: "acme" };
const digest = "a".repeat(64);
const pinned = "b".repeat(64);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertPackageIsTrusted", () => {
  it("accepts an upload whose digest matches the pin", () => {
    vi.stubEnv("JUSTFLOWS_TRUSTED_PACKAGE_DIGESTS", `acme.theme:${digest}`);
    expect(() => assertPackageIsTrusted(manifest, digest)).not.toThrow();
  });

  it("rejects an upload whose digest differs from the pin", () => {
    vi.stubEnv("JUSTFLOWS_TRUSTED_PACKAGE_DIGESTS", `acme.theme:${pinned}`);
    expect(() => assertPackageIsTrusted(manifest, digest)).toThrow(/does not match trusted value/);
  });

  it("still applies the pin when a marketplace signature does not verify", () => {
    vi.stubEnv("JUSTFLOWS_TRUSTED_PACKAGE_DIGESTS", `acme.theme:${pinned}`);
    expect(() =>
      assertPackageIsTrusted(manifest, digest, { marketplaceSignature: "bm90IGEgc2lnbmF0dXJl" }),
    ).toThrow(/does not match trusted value/);
  });
});
