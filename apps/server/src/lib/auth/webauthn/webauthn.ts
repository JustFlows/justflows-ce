// SPDX-License-Identifier: MIT

import { X509Certificate, createHash, createPublicKey, timingSafeEqual, verify, type KeyObject } from "node:crypto";
import { decodeCbor, decodeCborItem, type CborValue } from "./cbor.js";

/**
 * WebAuthn Level 3 relying-party verification on Node builtins.
 *
 * No dependency, for the same reason TOTP has none: this code decides who gets
 * a session, and a package on that path is a supply-chain decision. The scope
 * is what a relying party needs to trust a passkey:
 *
 * - client data: ceremony type, challenge, origin, and no cross-origin use;
 * - authenticator data: RP ID hash, user presence, user verification, the
 *   signature counter, and the backup flags;
 * - COSE public keys for ES256, EdDSA (Ed25519) and RS256;
 * - attestation statements in the `none`, `packed` and `fido-u2f` formats.
 *
 * Attestation certificates are not chained to the FIDO Metadata Service. A
 * `packed` statement with a certificate proves the authenticator holds that
 * certificate's key, not that the certificate came from the vendor it names. The
 * operator's AAGUID allow-list is therefore a policy filter, not cryptographic
 * proof of the model. Other formats (tpm, apple, android-key, android-safetynet)
 * are recorded but not verified.
 */

export class WebAuthnError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "WebAuthnError";
  }
}

/** COSE algorithm identifiers, in the order the server prefers them. */
export const COSE_ALG = { ES256: -7, EdDSA: -8, RS256: -257 } as const;
export const SUPPORTED_ALGORITHMS: readonly number[] = [COSE_ALG.ES256, COSE_ALG.EdDSA, COSE_ALG.RS256];

/** The spec's ceiling on credential id length. */
export const MAX_CREDENTIAL_ID_BYTES = 1023;

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;
const FLAG_ED = 0x80;

const BASE64URL = /^[A-Za-z0-9_-]*$/;

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** Strict base64url: Node's decoder silently skips characters it does not know. */
export function fromBase64Url(value: unknown, field: string, maxBytes = 65_536): Buffer {
  if (typeof value !== "string" || !BASE64URL.test(value) || value.length > Math.ceil((maxBytes * 4) / 3) + 4) {
    throw new WebAuthnError("malformed", `${field} is not valid base64url`);
  }
  return Buffer.from(value, "base64url");
}

export function sha256(data: Uint8Array): Buffer {
  return createHash("sha256").update(data).digest();
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Client data ──────────────────────────────────────────────────────────────

export interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

export function parseClientData(raw: Buffer): ClientData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new WebAuthnError("malformed", "clientDataJSON is not JSON");
  }
  const data = parsed as Record<string, unknown>;
  if (!data || typeof data !== "object" || typeof data.type !== "string" || typeof data.challenge !== "string" || typeof data.origin !== "string") {
    throw new WebAuthnError("malformed", "clientDataJSON is missing fields");
  }
  return { type: data.type, challenge: data.challenge, origin: data.origin, crossOrigin: data.crossOrigin === true };
}

function checkClientData(clientData: ClientData, type: string, expected: CeremonyExpectation): void {
  if (clientData.type !== type) throw new WebAuthnError("type", "The response is for a different ceremony");
  const supplied = Buffer.from(clientData.challenge);
  const wanted = Buffer.from(expected.challenge);
  if (!equalBytes(supplied, wanted)) throw new WebAuthnError("challenge", "The challenge does not match");
  if (!expected.origins.includes(clientData.origin)) throw new WebAuthnError("origin", "The response came from an origin this site does not accept");
  if (clientData.crossOrigin) throw new WebAuthnError("origin", "Cross-origin passkey use is not accepted");
}

// ── Authenticator data ───────────────────────────────────────────────────────

export interface AuthenticatorData {
  rpIdHash: Buffer;
  flags: number;
  userPresent: boolean;
  userVerified: boolean;
  backupEligible: boolean;
  backupState: boolean;
  signCount: number;
  attested?: { aaguid: string; credentialId: Buffer; publicKey: Buffer };
}

function formatAaguid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parseAuthenticatorData(data: Buffer): AuthenticatorData {
  if (data.length < 37) throw new WebAuthnError("malformed", "Authenticator data is too short");
  const flags = data[32]!;
  const result: AuthenticatorData = {
    rpIdHash: data.subarray(0, 32),
    flags,
    userPresent: (flags & FLAG_UP) !== 0,
    userVerified: (flags & FLAG_UV) !== 0,
    backupEligible: (flags & FLAG_BE) !== 0,
    backupState: (flags & FLAG_BS) !== 0,
    signCount: data.readUInt32BE(33),
  };
  if (result.backupState && !result.backupEligible) {
    throw new WebAuthnError("malformed", "Authenticator data claims a backup it is not eligible for");
  }
  let offset = 37;
  if (flags & FLAG_AT) {
    if (data.length < offset + 18) throw new WebAuthnError("malformed", "Attested credential data is truncated");
    const aaguid = data.subarray(offset, offset + 16);
    const idLength = data.readUInt16BE(offset + 16);
    offset += 18;
    if (idLength === 0 || idLength > MAX_CREDENTIAL_ID_BYTES || data.length < offset + idLength) {
      throw new WebAuthnError("malformed", "Credential id has an invalid length");
    }
    const credentialId = data.subarray(offset, offset + idLength);
    offset += idLength;
    let end: number;
    try {
      end = decodeCborItem(data, offset).end;
    } catch {
      throw new WebAuthnError("malformed", "Credential public key is not valid CBOR");
    }
    result.attested = { aaguid: formatAaguid(aaguid), credentialId: Buffer.from(credentialId), publicKey: Buffer.from(data.subarray(offset, end)) };
    offset = end;
  }
  if (flags & FLAG_ED) {
    try {
      const { value, end } = decodeCborItem(data, offset);
      if (!(value instanceof Map)) throw new Error("not a map");
      offset = end;
    } catch {
      throw new WebAuthnError("malformed", "Authenticator extensions are not valid CBOR");
    }
  }
  if (offset !== data.length) throw new WebAuthnError("malformed", "Unexpected bytes after the authenticator data");
  return result;
}

function checkAuthenticatorData(auth: AuthenticatorData, expected: CeremonyExpectation): void {
  if (!equalBytes(auth.rpIdHash, sha256(Buffer.from(expected.rpId)))) {
    throw new WebAuthnError("rp", "The passkey belongs to a different site");
  }
  if (!auth.userPresent) throw new WebAuthnError("presence", "The authenticator did not confirm user presence");
  if (expected.requireUserVerification && !auth.userVerified) {
    throw new WebAuthnError("verification", "The authenticator did not verify the user (PIN or biometric)");
  }
}

// ── COSE keys ────────────────────────────────────────────────────────────────

function coseBytes(map: Map<CborValue, CborValue>, key: number, length?: number): Buffer {
  const value = map.get(key);
  if (!(value instanceof Uint8Array) || (length !== undefined && value.length !== length)) {
    throw new WebAuthnError("key", "The public key is malformed");
  }
  return Buffer.from(value);
}

/** Turn a COSE_Key into a Node key object, checking it matches its algorithm. */
export function coseToKeyObject(cose: Uint8Array): { key: KeyObject; algorithm: number } {
  let decoded: CborValue;
  try {
    decoded = decodeCbor(cose);
  } catch {
    throw new WebAuthnError("key", "The public key is not valid CBOR");
  }
  if (!(decoded instanceof Map)) throw new WebAuthnError("key", "The public key is malformed");
  const kty = decoded.get(1);
  const alg = decoded.get(3);
  try {
    if (kty === 2 && alg === COSE_ALG.ES256) {
      if (decoded.get(-1) !== 1) throw new WebAuthnError("key", "Only the P-256 curve is accepted for ES256");
      const key = createPublicKey({
        key: { kty: "EC", crv: "P-256", x: coseBytes(decoded, -2, 32).toString("base64url"), y: coseBytes(decoded, -3, 32).toString("base64url") },
        format: "jwk",
      });
      return { key, algorithm: alg };
    }
    if (kty === 1 && alg === COSE_ALG.EdDSA) {
      if (decoded.get(-1) !== 6) throw new WebAuthnError("key", "Only Ed25519 is accepted for EdDSA");
      const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: coseBytes(decoded, -2, 32).toString("base64url") }, format: "jwk" });
      return { key, algorithm: alg };
    }
    if (kty === 3 && alg === COSE_ALG.RS256) {
      const n = coseBytes(decoded, -1);
      const e = coseBytes(decoded, -2);
      const key = createPublicKey({ key: { kty: "RSA", n: n.toString("base64url"), e: e.toString("base64url") }, format: "jwk" });
      if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new WebAuthnError("key", "RSA keys must be at least 2048 bits");
      return { key, algorithm: alg };
    }
  } catch (err) {
    if (err instanceof WebAuthnError) throw err;
    throw new WebAuthnError("key", "The public key could not be loaded");
  }
  throw new WebAuthnError("algorithm", "The passkey uses an algorithm this site does not accept");
}

function verifySignature(algorithm: number, key: KeyObject, data: Buffer, signature: Buffer): boolean {
  try {
    if (algorithm === COSE_ALG.ES256) return verify("sha256", data, { key, dsaEncoding: "der" }, signature);
    if (algorithm === COSE_ALG.RS256) return verify("sha256", data, key, signature);
    if (algorithm === COSE_ALG.EdDSA) return verify(null, data, key, signature);
  } catch {
    return false;
  }
  return false;
}

// ── Attestation ──────────────────────────────────────────────────────────────

/** OID 1.3.6.1.4.1.45724.1.1.4 (id-fido-gen-ce-aaguid), followed by OCTET STRING(OCTET STRING(16)). */
const AAGUID_EXTENSION = Buffer.from("060b2b0601040182e51c010104", "hex");

function certificateAaguid(cert: X509Certificate): string | null {
  const der = cert.raw;
  const at = der.indexOf(AAGUID_EXTENSION);
  if (at === -1) return null;
  /** Optional `critical` BOOLEAN between the OID and the value. */
  let offset = at + AAGUID_EXTENSION.length;
  if (der[offset] === 0x01 && der[offset + 1] === 0x01) offset += 3;
  if (der[offset] !== 0x04 || der[offset + 1] !== 0x12 || der[offset + 2] !== 0x04 || der[offset + 3] !== 0x10) return null;
  return formatAaguid(der.subarray(offset + 4, offset + 20));
}

export interface AttestationResult {
  format: string;
  /** True only when the statement's signature was checked against a certificate. */
  certified: boolean;
}

function verifyAttestation(
  format: string,
  statement: Map<CborValue, CborValue>,
  authData: Buffer,
  auth: AuthenticatorData,
  clientDataHash: Buffer,
  credential: { key: KeyObject; algorithm: number },
): AttestationResult {
  const signed = Buffer.concat([authData, clientDataHash]);
  if (format === "none") {
    if (statement.size !== 0) throw new WebAuthnError("attestation", "A `none` attestation must be empty");
    return { format, certified: false };
  }
  if (format === "packed") {
    const alg = statement.get("alg");
    const sig = statement.get("sig");
    const x5c = statement.get("x5c");
    if (typeof alg !== "number" || !(sig instanceof Uint8Array)) throw new WebAuthnError("attestation", "The packed attestation is malformed");
    if (x5c === undefined) {
      if (alg !== credential.algorithm || !verifySignature(alg, credential.key, signed, Buffer.from(sig))) {
        throw new WebAuthnError("attestation", "The self-attestation signature is invalid");
      }
      return { format, certified: false };
    }
    if (!Array.isArray(x5c) || !(x5c[0] instanceof Uint8Array)) throw new WebAuthnError("attestation", "The attestation certificate is missing");
    let leaf: X509Certificate;
    try {
      leaf = new X509Certificate(Buffer.from(x5c[0]));
    } catch {
      throw new WebAuthnError("attestation", "The attestation certificate cannot be read");
    }
    if (leaf.ca || !/(^|\n)OU=Authenticator Attestation(\n|$)/.test(leaf.subject)) {
      throw new WebAuthnError("attestation", "The attestation certificate is not an authenticator certificate");
    }
    const certAaguid = certificateAaguid(leaf);
    if (certAaguid && auth.attested && certAaguid !== auth.attested.aaguid) {
      throw new WebAuthnError("attestation", "The attestation certificate names a different authenticator model");
    }
    if (!SUPPORTED_ALGORITHMS.includes(alg) || !verifySignature(alg, leaf.publicKey, signed, Buffer.from(sig))) {
      throw new WebAuthnError("attestation", "The attestation signature is invalid");
    }
    return { format, certified: true };
  }
  if (format === "fido-u2f") {
    const sig = statement.get("sig");
    const x5c = statement.get("x5c");
    if (!(sig instanceof Uint8Array) || !Array.isArray(x5c) || x5c.length !== 1 || !(x5c[0] instanceof Uint8Array)) {
      throw new WebAuthnError("attestation", "The U2F attestation is malformed");
    }
    if (credential.algorithm !== COSE_ALG.ES256 || !auth.attested) throw new WebAuthnError("attestation", "A U2F key must use ES256");
    let leaf: X509Certificate;
    try {
      leaf = new X509Certificate(Buffer.from(x5c[0]));
    } catch {
      throw new WebAuthnError("attestation", "The attestation certificate cannot be read");
    }
    const jwk = credential.key.export({ format: "jwk" }) as { x: string; y: string };
    const publicKeyU2F = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
    const data = Buffer.concat([Buffer.from([0x00]), auth.rpIdHash, clientDataHash, auth.attested.credentialId, publicKeyU2F]);
    if (!verifySignature(COSE_ALG.ES256, leaf.publicKey, data, Buffer.from(sig))) {
      throw new WebAuthnError("attestation", "The U2F attestation signature is invalid");
    }
    return { format, certified: true };
  }
  if (/^(tpm|apple|android-key|android-safetynet)$/.test(format)) return { format, certified: false };
  throw new WebAuthnError("attestation", "The attestation format is not recognised");
}

// ── Ceremonies ───────────────────────────────────────────────────────────────

export interface CeremonyExpectation {
  /** base64url challenge issued for this ceremony. */
  challenge: string;
  /** Origins that may have produced the response, e.g. `https://example.com`. */
  origins: string[];
  rpId: string;
  requireUserVerification: boolean;
}

export interface RegistrationExpectation extends CeremonyExpectation {
  /** `none`: statements are not inspected. `direct`: they are verified where the format allows. */
  attestation: "none" | "direct";
  /** Lower-case AAGUIDs. Empty means any authenticator. Enforced only with `direct`. */
  allowedAaguids: string[];
}

export interface RegistrationResponse {
  id: string;
  rawId: string;
  type: string;
  response: { clientDataJSON: string; attestationObject: string; transports?: unknown };
}

export interface VerifiedRegistration {
  credentialId: string;
  publicKey: string;
  algorithm: number;
  signCount: number;
  aaguid: string;
  attestationFormat: string;
  attestationCertified: boolean;
  backupEligible: boolean;
  backupState: boolean;
  userVerified: boolean;
  transports: string[];
}

const TRANSPORTS = new Set(["usb", "nfc", "ble", "smart-card", "hybrid", "internal", "cable"]);

export function verifyRegistration(response: RegistrationResponse, expected: RegistrationExpectation): VerifiedRegistration {
  if (!response || response.type !== "public-key" || !response.response) throw new WebAuthnError("malformed", "Not a public-key credential");
  const rawId = fromBase64Url(response.rawId, "rawId", MAX_CREDENTIAL_ID_BYTES);
  if (response.id !== response.rawId) throw new WebAuthnError("malformed", "Credential id and rawId differ");
  const clientDataRaw = fromBase64Url(response.response.clientDataJSON, "clientDataJSON");
  checkClientData(parseClientData(clientDataRaw), "webauthn.create", expected);

  let attestation: CborValue;
  try {
    attestation = decodeCbor(fromBase64Url(response.response.attestationObject, "attestationObject"));
  } catch (err) {
    if (err instanceof WebAuthnError) throw err;
    throw new WebAuthnError("malformed", "The attestation object is not valid CBOR");
  }
  if (!(attestation instanceof Map)) throw new WebAuthnError("malformed", "The attestation object is malformed");
  const format = attestation.get("fmt");
  const statement = attestation.get("attStmt");
  const authDataValue = attestation.get("authData");
  if (typeof format !== "string" || !(statement instanceof Map) || !(authDataValue instanceof Uint8Array)) {
    throw new WebAuthnError("malformed", "The attestation object is missing fields");
  }
  const authData = Buffer.from(authDataValue);
  const auth = parseAuthenticatorData(authData);
  checkAuthenticatorData(auth, expected);
  if (!auth.attested) throw new WebAuthnError("malformed", "The response carries no credential");
  if (!equalBytes(auth.attested.credentialId, rawId)) throw new WebAuthnError("malformed", "The credential id does not match the authenticator data");

  const credential = coseToKeyObject(auth.attested.publicKey);
  let result: AttestationResult = { format, certified: false };
  if (expected.attestation === "direct") {
    result = verifyAttestation(format, statement, authData, auth, sha256(clientDataRaw), credential);
    if (expected.allowedAaguids.length) {
      if (!result.certified || !expected.allowedAaguids.includes(auth.attested.aaguid)) {
        throw new WebAuthnError("aaguid", "This security key model is not allowed on this site");
      }
    }
  }

  const transports = Array.isArray(response.response.transports)
    ? [...new Set(response.response.transports.filter((t): t is string => typeof t === "string" && TRANSPORTS.has(t)))]
    : [];

  return {
    credentialId: toBase64Url(rawId),
    publicKey: toBase64Url(auth.attested.publicKey),
    algorithm: credential.algorithm,
    signCount: auth.signCount,
    aaguid: auth.attested.aaguid,
    attestationFormat: result.format,
    attestationCertified: result.certified,
    backupEligible: auth.backupEligible,
    backupState: auth.backupState,
    userVerified: auth.userVerified,
    transports,
  };
}

export interface AuthenticationResponse {
  id: string;
  rawId: string;
  type: string;
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string | null };
}

export interface StoredCredential {
  publicKey: string;
  signCount: number;
  /** base64url user handle the credential was registered with. */
  userHandle: string;
}

export interface VerifiedAuthentication {
  signCount: number;
  userVerified: boolean;
  backupState: boolean;
}

export function verifyAuthentication(
  response: AuthenticationResponse,
  expected: CeremonyExpectation,
  stored: StoredCredential,
): VerifiedAuthentication {
  if (!response || response.type !== "public-key" || !response.response) throw new WebAuthnError("malformed", "Not a public-key credential");
  if (response.id !== response.rawId) throw new WebAuthnError("malformed", "Credential id and rawId differ");
  const clientDataRaw = fromBase64Url(response.response.clientDataJSON, "clientDataJSON");
  checkClientData(parseClientData(clientDataRaw), "webauthn.get", expected);
  const authData = fromBase64Url(response.response.authenticatorData, "authenticatorData");
  const signature = fromBase64Url(response.response.signature, "signature", 1024);
  const auth = parseAuthenticatorData(authData);
  if (auth.attested) throw new WebAuthnError("malformed", "A sign-in response must not carry a new credential");
  checkAuthenticatorData(auth, expected);

  if (response.response.userHandle != null && response.response.userHandle !== "") {
    const supplied = fromBase64Url(response.response.userHandle, "userHandle", 64);
    if (!equalBytes(supplied, Buffer.from(stored.userHandle, "base64url"))) {
      throw new WebAuthnError("user", "The passkey belongs to a different account");
    }
  }

  const { key, algorithm } = coseToKeyObject(Buffer.from(stored.publicKey, "base64url"));
  if (!verifySignature(algorithm, key, Buffer.concat([authData, sha256(clientDataRaw)]), signature)) {
    throw new WebAuthnError("signature", "The passkey signature is invalid");
  }

  /**
   * A counter that stopped increasing means two copies of a key that should
   * not be copyable. Synced passkeys report 0 throughout, which is allowed.
   */
  if ((auth.signCount > 0 || stored.signCount > 0) && auth.signCount <= stored.signCount) {
    throw new WebAuthnError("counter", "The passkey's signature counter went backwards");
  }

  return { signCount: auth.signCount, userVerified: auth.userVerified, backupState: auth.backupState };
}

/** The user handle for an account: its id, which is random and carries no personal data. */
export function userHandleFor(userId: string): string {
  return toBase64Url(Buffer.from(userId, "utf8"));
}
