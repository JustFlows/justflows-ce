import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature } from "node:crypto";

function readTrustedDigests(): Map<string, string> {
  const raw = process.env.JUSTFLOWS_TRUSTED_PACKAGE_DIGESTS ?? "";
  const map = new Map<string, string>();
  for (const part of raw.split(",")) {
    const [id, digest] = part.split(":").map((s) => s.trim());
    if (id && digest) map.set(id, digest.toLowerCase());
  }
  return map;
}

/**
 * Package authenticity is required by default as of 0.1.2. Installing a package
 * runs its code in this process, so an unverified upload is equivalent to shell
 * access — that has to be a deliberate choice, not the path of least resistance.
 *
 * `JUSTFLOWS_ALLOW_UNSIGNED_PACKAGES=1` opts out, for local development and for
 * operators who build their own packages and accept the risk.
 * `JUSTFLOWS_REQUIRE_SIGNED_PACKAGES=1` is kept as a no-op alias so existing
 * hardened deployments do not break; it can be removed once 0.1.x is retired.
 */
export function allowUnsignedPackages(): boolean {
  if (process.env.JUSTFLOWS_REQUIRE_SIGNED_PACKAGES === "1") return false;
  return process.env.JUSTFLOWS_ALLOW_UNSIGNED_PACKAGES === "1";
}

/**
 * Verify an operator's own countersignature over the canonical manifest JSON.
 *
 * This is NOT proof of provenance: the key is this installation's APP_SECRET, so
 * it only attests that someone with access to this server's secret vouched for
 * the package. It is the signed equivalent of pinning a digest, and carries the
 * same weight — no more. Publisher identity comes only from
 * verifyMarketplaceSignature, which checks a pinned Ed25519 public key.
 */
export function verifyManifestSignature(
  manifest: Record<string, unknown>,
  signature: string,
): boolean {
  const secret = process.env.APP_SECRET;
  if (!secret || !signature) return false;

  const payload = { ...manifest };
  delete payload.packageSignature;
  delete payload.signature;

  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const expected = createHmac("sha256", secret).update(canonical).digest("hex");

  try {
    const a = Buffer.from(expected, "utf-8");
    const b = Buffer.from(signature.toLowerCase(), "utf-8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Justflows marketplace Ed25519 public key (SPKI PEM).
 * Packages from api.justflows.com are signed with the matching private key.
 */
const JUSTFLOWS_MARKETPLACE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA2XeYyQg1/VM9A+y2Xh7Yw9+XYHBK6y7gUuOC6NVLZrw=
-----END PUBLIC KEY-----`;

export function marketplaceSignPayload(
  id: string,
  version: string,
  publisher: string,
  digestHex: string,
): Buffer {
  return Buffer.from(`${id}\n${version}\n${publisher}\n${digestHex.toLowerCase()}`, "utf8");
}

export function verifyMarketplaceSignature(
  digestHex: string,
  signatureB64: string,
  bind?: { id: string; version: string; publisher: string },
): boolean {
  if (!digestHex || !signatureB64) return false;

  try {
    const payload = bind
      ? marketplaceSignPayload(bind.id, bind.version, bind.publisher, digestHex)
      : Buffer.from(digestHex.toLowerCase(), "hex");
    const signature = Buffer.from(signatureB64, "base64");
    const key = createPublicKey(JUSTFLOWS_MARKETPLACE_PUBLIC_KEY);
    return verifySignature(null, payload, key, signature);
  } catch {
    return false;
  }
}

export interface PackageTrustOptions {
  marketplaceSignature?: string;
}

/** Reject untrusted package uploads unless digest or signature checks pass. */
export function assertPackageIsTrusted(
  manifest: Record<string, unknown>,
  digest: string,
  options?: PackageTrustOptions,
): void {
  const packageId = typeof manifest.id === "string" ? manifest.id : "";
  const trusted = readTrustedDigests();

  if (packageId && trusted.has(packageId)) {
    if (trusted.get(packageId) !== digest.toLowerCase()) {
      throw new Error(`Package digest does not match trusted value for ${packageId}`);
    }
    return;
  }

  if (options?.marketplaceSignature) {
    const version = typeof manifest.version === "string" ? manifest.version : "";
    const publisher = typeof manifest.publisher === "string" ? manifest.publisher : "";
    if (
      verifyMarketplaceSignature(digest, options.marketplaceSignature, {
        id: packageId,
        version,
        publisher,
      })
    ) {
      return;
    }
  }

  const signature =
    (typeof manifest.packageSignature === "string" && manifest.packageSignature) ||
    (typeof manifest.signature === "string" && manifest.signature) ||
    "";

  if (signature && verifyManifestSignature(manifest, signature)) {
    return;
  }

  if (allowUnsignedPackages()) {
    console.warn(
      `[justflows] SECURITY: installing unverified package "${packageId || "unknown"}" ` +
        `(digest ${digest.slice(0, 12)}…). JUSTFLOWS_ALLOW_UNSIGNED_PACKAGES is set.`,
    );
    return;
  }

  throw new Error(
    "This package could not be verified. Installing a package runs its code on your server, " +
      "so Justflows only accepts packages that carry a valid marketplace signature or whose " +
      "SHA-256 digest you have pinned.\n\n" +
      `Digest of the package you uploaded: ${digest}\n\n` +
      "To install it anyway, either pin it:\n" +
      `  JUSTFLOWS_TRUSTED_PACKAGE_DIGESTS=${packageId || "<package-id>"}:${digest}\n` +
      "or, if you build your own packages and accept the risk, allow unsigned installs:\n" +
      "  JUSTFLOWS_ALLOW_UNSIGNED_PACKAGES=1",
  );
}

/** Optional HMAC verification for core update archives. */
export function verifyUpdateArchiveSignature(buffer: Buffer, signature: string | undefined): void {
  const key = process.env.JUSTFLOWS_UPDATE_SIGNING_KEY;
  if (!key) return;

  if (!signature?.trim()) {
    throw new Error("Core update signature is required (JUSTFLOWS_UPDATE_SIGNING_KEY is set)");
  }

  const expected = createHmac("sha256", key).update(buffer).digest("hex");
  try {
    const a = Buffer.from(expected, "utf-8");
    const b = Buffer.from(signature.trim().toLowerCase(), "utf-8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("Core update signature is invalid");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("signature")) throw err;
    throw new Error("Core update signature is invalid");
  }
}
