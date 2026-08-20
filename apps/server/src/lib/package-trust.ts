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

export function requireSignedPackages(): boolean {
  return process.env.JUSTFLOWS_REQUIRE_SIGNED_PACKAGES === "1";
}

/** Verify HMAC-SHA256 signature over canonical manifest JSON (excluding signature fields). */
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

  if (requireSignedPackages()) {
    throw new Error(
      "Package is not trusted — set JUSTFLOWS_TRUSTED_PACKAGE_DIGESTS or include a valid packageSignature",
    );
  }
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
