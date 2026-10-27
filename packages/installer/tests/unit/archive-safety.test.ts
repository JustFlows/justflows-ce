import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArchiveSafetyError, resolveWithinDir, signPackage, verifyPackageSignature } from "../../src/archive-safety.js";

const base = path.resolve("/app/packages-installed");

describe("resolveWithinDir", () => {
  it("resolves ordinary manifest segments under the base", () => {
    expect(resolveWithinDir(base, "plugins", "acme.thing", "1.2.3")).toBe(
      path.join(base, "plugins", "acme.thing", "1.2.3"),
    );
  });

  // The C1 payload: a version the old schema accepted, which path.join() then
  // resolved to /tmp/pwned — the target of an fs.rm() and an fs.rename().
  it("refuses a segment that walks out of the base", () => {
    expect(() =>
      resolveWithinDir(base, "plugins", "acme.evil", "1.0.0/../../../../../../tmp/pwned"),
    ).toThrow(ArchiveSafetyError);
  });

  it("refuses path separators inside a segment", () => {
    expect(() => resolveWithinDir(base, "plugins", "acme.evil", "1.0.0/sub")).toThrow(
      ArchiveSafetyError,
    );
    expect(() => resolveWithinDir(base, "plugins", "acme.evil", "1.0.0\\sub")).toThrow(
      ArchiveSafetyError,
    );
  });

  it("refuses empty, dot and dot-dot segments", () => {
    for (const segment of ["", ".", ".."]) {
      expect(() => resolveWithinDir(base, "plugins", segment)).toThrow(ArchiveSafetyError);
    }
  });

  it("refuses a NUL byte", () => {
    expect(() => resolveWithinDir(base, "plugins", "acme.evil\0", "1.0.0")).toThrow(
      ArchiveSafetyError,
    );
  });

  // "packages-installed-evil" shares the prefix but is a different directory —
  // the separator in the comparison is what rules it out.
  it("refuses a sibling directory sharing the base prefix", () => {
    expect(() => resolveWithinDir(base, "..", "packages-installed-evil")).toThrow(
      ArchiveSafetyError,
    );
  });
});

describe("signPackage", () => {
  it("round-trips an Ed25519 signature and rejects a different archive", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const data = Buffer.from("helpdesk-archive");
    const signature = signPackage(data, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(verifyPackageSignature(data, signature, pem)).toBe(true);
    expect(verifyPackageSignature(Buffer.from("other"), signature, pem)).toBe(false);
  });
});
