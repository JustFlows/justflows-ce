// SPDX-License-Identifier: MIT

import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CborError, decodeCbor, encodeCbor, type CborValue } from "../../../src/lib/auth/webauthn/cbor.js";
import {
  COSE_ALG,
  WebAuthnError,
  userHandleFor,
  verifyAuthentication,
  verifyRegistration,
  type AuthenticationResponse,
  type RegistrationExpectation,
  type RegistrationResponse,
} from "../../../src/lib/auth/webauthn/webauthn.js";
import {
  DEFAULT_PASSKEY_POLICY,
  PasskeyPolicySchema,
  modeForRole,
  normalizePasskeyPolicy,
  resolveRelyingParty,
} from "../../../src/lib/auth/webauthn/passkey-policy.js";

/**
 * A software authenticator: real keys, real CBOR, real signatures. Every
 * ceremony below is what a browser would hand the server, so the verifier is
 * exercised end to end without a browser.
 */

const RP_ID = "example.com";
const ORIGIN = "https://example.com";
const AAGUID = Buffer.from("cb69481e8ff7403993ec0a2729a154a8", "hex");
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest();

type Kind = "es256" | "ed25519" | "rs256";

function makeKey(kind: Kind): { privateKey: KeyObject; cose: Uint8Array; alg: number } {
  if (kind === "es256") {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const cose = encodeCbor(new Map<CborValue, CborValue>([[1, 2], [3, COSE_ALG.ES256], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
    return { privateKey, cose, alg: COSE_ALG.ES256 };
  }
  if (kind === "ed25519") {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const jwk = publicKey.export({ format: "jwk" }) as { x: string };
    const cose = encodeCbor(new Map<CborValue, CborValue>([[1, 1], [3, COSE_ALG.EdDSA], [-1, 6], [-2, Buffer.from(jwk.x, "base64url")]]));
    return { privateKey, cose, alg: COSE_ALG.EdDSA };
  }
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  const cose = encodeCbor(new Map<CborValue, CborValue>([[1, 3], [3, COSE_ALG.RS256], [-1, Buffer.from(jwk.n, "base64url")], [-2, Buffer.from(jwk.e, "base64url")]]));
  return { privateKey, cose, alg: COSE_ALG.RS256 };
}

function signWith(kind: Kind, privateKey: KeyObject, data: Buffer): Buffer {
  return kind === "ed25519" ? sign(null, data, privateKey) : sign("sha256", data, privateKey);
}

const FLAGS = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40 };

function authData(options: { rpId?: string; flags: number; counter?: number; credentialId?: Buffer; cose?: Uint8Array }): Buffer {
  const head = Buffer.alloc(37);
  sha256(Buffer.from(options.rpId ?? RP_ID)).copy(head, 0);
  head[32] = options.flags;
  head.writeUInt32BE(options.counter ?? 0, 33);
  if (!options.credentialId || !options.cose) return head;
  const length = Buffer.alloc(2);
  length.writeUInt16BE(options.credentialId.length);
  return Buffer.concat([head, AAGUID, length, options.credentialId, Buffer.from(options.cose)]);
}

function clientData(type: string, challenge: string, overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN, crossOrigin: false, ...overrides }));
}

function expectation(challenge: string, overrides: Partial<RegistrationExpectation> = {}): RegistrationExpectation {
  return { challenge, origins: [ORIGIN], rpId: RP_ID, requireUserVerification: false, attestation: "none", allowedAaguids: [], ...overrides };
}

function makeAuthenticator(kind: Kind = "es256") {
  const key = makeKey(kind);
  const credentialId = randomBytes(32);
  let counter = 0;
  return {
    key,
    credentialId,
    register(challenge: string, options: { flags?: number; fmt?: string; attStmt?: Map<CborValue, CborValue>; client?: Record<string, unknown>; rpId?: string } = {}): RegistrationResponse {
      const data = authData({ rpId: options.rpId, flags: options.flags ?? FLAGS.UP | FLAGS.UV | FLAGS.AT, credentialId, cose: key.cose });
      const client = clientData("webauthn.create", challenge, options.client);
      let attStmt = options.attStmt ?? new Map();
      if (options.fmt === "packed" && !options.attStmt) {
        attStmt = new Map<CborValue, CborValue>([["alg", key.alg], ["sig", signWith(kind, key.privateKey, Buffer.concat([data, sha256(client)]))]]);
      }
      const attestationObject = encodeCbor(new Map<CborValue, CborValue>([["fmt", options.fmt ?? "none"], ["attStmt", attStmt], ["authData", data]]));
      return {
        id: b64(credentialId),
        rawId: b64(credentialId),
        type: "public-key",
        response: { clientDataJSON: b64(client), attestationObject: b64(attestationObject), transports: ["internal", "bogus"] },
      };
    },
    assert(challenge: string, options: { flags?: number; counter?: number; userHandle?: string | null; client?: Record<string, unknown>; tamper?: boolean } = {}): AuthenticationResponse {
      counter = options.counter ?? counter + 1;
      const data = authData({ flags: options.flags ?? FLAGS.UP | FLAGS.UV, counter });
      const client = clientData("webauthn.get", challenge, options.client);
      const signature = signWith(kind, key.privateKey, Buffer.concat([data, sha256(client)]));
      if (options.tamper) signature.writeUInt8(signature.readUInt8(signature.length - 1) ^ 0xff, signature.length - 1);
      return {
        id: b64(credentialId),
        rawId: b64(credentialId),
        type: "public-key",
        response: {
          clientDataJSON: b64(client),
          authenticatorData: b64(data),
          signature: b64(signature),
          userHandle: options.userHandle === undefined ? userHandleFor("user-1") : options.userHandle,
        },
      };
    },
  };
}

const challenge = () => b64(randomBytes(32));

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof WebAuthnError) return err.code;
    throw err;
  }
  return "ok";
}

describe("WebAuthn registration", () => {
  for (const kind of ["es256", "ed25519", "rs256"] as const) {
    it(`accepts a ${kind} passkey and returns what must be stored`, () => {
      const authenticator = makeAuthenticator(kind);
      const c = challenge();
      const result = verifyRegistration(authenticator.register(c), expectation(c));
      expect(result.credentialId).toBe(b64(authenticator.credentialId));
      expect(result.algorithm).toBe(authenticator.key.alg);
      expect(result.aaguid).toBe("cb69481e-8ff7-4039-93ec-0a2729a154a8");
      expect(result.userVerified).toBe(true);
      expect(result.transports).toEqual(["internal"]);
    });
  }

  it("refuses responses bound to another challenge, origin, ceremony or site", () => {
    const authenticator = makeAuthenticator();
    const c = challenge();
    expect(code(() => verifyRegistration(authenticator.register(challenge()), expectation(c)))).toBe("challenge");
    expect(code(() => verifyRegistration(authenticator.register(c, { client: { origin: "https://evil.example" } }), expectation(c)))).toBe("origin");
    expect(code(() => verifyRegistration(authenticator.register(c, { client: { crossOrigin: true } }), expectation(c)))).toBe("origin");
    expect(code(() => verifyRegistration(authenticator.register(c, { client: { type: "webauthn.get" } }), expectation(c)))).toBe("type");
    expect(code(() => verifyRegistration(authenticator.register(c, { rpId: "evil.example" }), expectation(c)))).toBe("rp");
  });

  it("requires user presence, and user verification when asked", () => {
    const authenticator = makeAuthenticator();
    const c = challenge();
    expect(code(() => verifyRegistration(authenticator.register(c, { flags: FLAGS.AT | FLAGS.UV }), expectation(c)))).toBe("presence");
    expect(code(() => verifyRegistration(authenticator.register(c, { flags: FLAGS.AT | FLAGS.UP }), expectation(c, { requireUserVerification: true })))).toBe("verification");
    expect(code(() => verifyRegistration(authenticator.register(c, { flags: FLAGS.AT | FLAGS.UP }), expectation(c)))).toBe("ok");
  });

  it("refuses a backup state without backup eligibility", () => {
    const authenticator = makeAuthenticator();
    const c = challenge();
    expect(code(() => verifyRegistration(authenticator.register(c, { flags: FLAGS.AT | FLAGS.UP | FLAGS.BS }), expectation(c)))).toBe("malformed");
  });

  it("refuses an algorithm it does not support", () => {
    const authenticator = makeAuthenticator();
    const c = challenge();
    const bogus = encodeCbor(new Map<CborValue, CborValue>([[1, 2], [3, -36], [-1, 1], [-2, Buffer.alloc(32)], [-3, Buffer.alloc(32)]]));
    authenticator.key.cose = bogus;
    expect(code(() => verifyRegistration(authenticator.register(c), expectation(c)))).toBe("algorithm");
  });

  it("verifies packed self-attestation under a direct policy, and rejects a forged one", () => {
    const authenticator = makeAuthenticator();
    const c = challenge();
    const ok = verifyRegistration(authenticator.register(c, { fmt: "packed" }), expectation(c, { attestation: "direct" }));
    expect(ok.attestationFormat).toBe("packed");
    expect(ok.attestationCertified).toBe(false);
    const forged = new Map<CborValue, CborValue>([["alg", COSE_ALG.ES256], ["sig", randomBytes(70)]]);
    expect(code(() => verifyRegistration(authenticator.register(c, { fmt: "packed", attStmt: forged }), expectation(c, { attestation: "direct" })))).toBe("attestation");
  });

  it("refuses an AAGUID allow-list match without a certified attestation", () => {
    const authenticator = makeAuthenticator();
    const c = challenge();
    const allowed = ["cb69481e-8ff7-4039-93ec-0a2729a154a8"];
    expect(code(() => verifyRegistration(authenticator.register(c, { fmt: "packed" }), expectation(c, { attestation: "direct", allowedAaguids: allowed })))).toBe("aaguid");
    expect(code(() => verifyRegistration(authenticator.register(c), expectation(c, { attestation: "direct", allowedAaguids: allowed })))).toBe("aaguid");
  });

  it("does not inspect statements under the default `none` policy", () => {
    const authenticator = makeAuthenticator();
    const c = challenge();
    const junk = new Map<CborValue, CborValue>([["sig", randomBytes(8)]]);
    expect(code(() => verifyRegistration(authenticator.register(c, { fmt: "packed", attStmt: junk }), expectation(c)))).toBe("ok");
    expect(code(() => verifyRegistration(authenticator.register(c, { fmt: "none", attStmt: junk }), expectation(c, { attestation: "direct" })))).toBe("attestation");
  });

  it("refuses a credential whose id differs from the authenticator data", () => {
    const authenticator = makeAuthenticator();
    const c = challenge();
    const response = authenticator.register(c);
    const other = b64(randomBytes(32));
    expect(code(() => verifyRegistration({ ...response, id: other, rawId: other }, expectation(c)))).toBe("malformed");
    expect(code(() => verifyRegistration({ ...response, id: other }, expectation(c)))).toBe("malformed");
  });
});

describe("WebAuthn sign-in", () => {
  function registered(kind: Kind = "es256") {
    const authenticator = makeAuthenticator(kind);
    const c = challenge();
    const stored = verifyRegistration(authenticator.register(c), expectation(c));
    return { authenticator, stored: { publicKey: stored.publicKey, signCount: stored.signCount, userHandle: userHandleFor("user-1") } };
  }
  const expect2 = (c: string, uv = false) => ({ challenge: c, origins: [ORIGIN], rpId: RP_ID, requireUserVerification: uv });

  for (const kind of ["es256", "ed25519", "rs256"] as const) {
    it(`accepts a valid ${kind} assertion and reports the new counter`, () => {
      const { authenticator, stored } = registered(kind);
      const c = challenge();
      const result = verifyAuthentication(authenticator.assert(c), expect2(c, true), stored);
      expect(result.signCount).toBe(1);
      expect(result.userVerified).toBe(true);
    });
  }

  it("refuses a bad signature, another account's handle, and a replay to another origin", () => {
    const { authenticator, stored } = registered();
    const c = challenge();
    expect(code(() => verifyAuthentication(authenticator.assert(c, { tamper: true }), expect2(c), stored))).toBe("signature");
    expect(code(() => verifyAuthentication(authenticator.assert(c, { userHandle: userHandleFor("user-2") }), expect2(c), stored))).toBe("user");
    expect(code(() => verifyAuthentication(authenticator.assert(c, { client: { origin: "https://evil.example" } }), expect2(c), stored))).toBe("origin");
    expect(code(() => verifyAuthentication(authenticator.assert(challenge()), expect2(c), stored))).toBe("challenge");
  });

  it("requires user verification for passwordless sign-in", () => {
    const { authenticator, stored } = registered();
    const c = challenge();
    expect(code(() => verifyAuthentication(authenticator.assert(c, { flags: FLAGS.UP }), expect2(c, true), stored))).toBe("verification");
    expect(code(() => verifyAuthentication(authenticator.assert(c, { flags: FLAGS.UP }), expect2(c, false), stored))).toBe("ok");
  });

  it("detects a cloned authenticator by its counter, and allows synced keys that stay at zero", () => {
    const { authenticator, stored } = registered();
    const c = challenge();
    expect(code(() => verifyAuthentication(authenticator.assert(c, { counter: 5 }), expect2(c), { ...stored, signCount: 5 }))).toBe("counter");
    expect(code(() => verifyAuthentication(authenticator.assert(c, { counter: 4 }), expect2(c), { ...stored, signCount: 5 }))).toBe("counter");
    expect(code(() => verifyAuthentication(authenticator.assert(c, { counter: 0 }), expect2(c), { ...stored, signCount: 0 }))).toBe("ok");
  });

  it("accepts a response with no user handle (non-discoverable credential)", () => {
    const { authenticator, stored } = registered();
    const c = challenge();
    expect(code(() => verifyAuthentication(authenticator.assert(c, { userHandle: null }), expect2(c), stored))).toBe("ok");
  });

  it("refuses malformed base64url rather than decoding it loosely", () => {
    const { authenticator, stored } = registered();
    const c = challenge();
    const response = authenticator.assert(c);
    response.response.signature = "not base64url!";
    expect(code(() => verifyAuthentication(response, expect2(c), stored))).toBe("malformed");
  });
});

describe("CBOR decoding of untrusted input", () => {
  it("round-trips the subset WebAuthn uses", () => {
    const value = new Map<CborValue, CborValue>([["fmt", "none"], [3, -7], ["list", [1, true, null, Buffer.from([1, 2])]]]);
    const decoded = decodeCbor(encodeCbor(value)) as Map<CborValue, CborValue>;
    expect(decoded.get("fmt")).toBe("none");
    expect(decoded.get(3)).toBe(-7);
  });

  it("refuses truncated, oversized, duplicated and deeply nested input", () => {
    expect(() => decodeCbor(Uint8Array.from([0x5a, 0xff, 0xff, 0xff, 0xff]))).toThrow(CborError);
    expect(() => decodeCbor(Uint8Array.from([0xa2, 0x01, 0x01, 0x01, 0x02]))).toThrow(CborError);
    expect(() => decodeCbor(Uint8Array.from([...new Array(40).fill(0x81), 0x00]))).toThrow(CborError);
    expect(() => decodeCbor(Uint8Array.from([0x00, 0x00]))).toThrow(CborError);
    expect(() => decodeCbor(Uint8Array.from([0xf9, 0x3c, 0x00]))).toThrow(CborError);
  });
});

describe("passkey policy", () => {
  it("falls back to defaults for anything it cannot read", () => {
    expect(normalizePasskeyPolicy(null)).toEqual(DEFAULT_PASSKEY_POLICY);
    expect(normalizePasskeyPolicy({ defaultMode: "sometimes" })).toEqual(DEFAULT_PASSKEY_POLICY);
    expect(normalizePasskeyPolicy({ roles: { administrator: "require" } }).roles).toEqual({ administrator: "require" });
  });

  it("resolves the mode per role", () => {
    const policy = normalizePasskeyPolicy({ defaultMode: "disallow", roles: { administrator: "require" } });
    expect(modeForRole(policy, "administrator")).toBe("require");
    expect(modeForRole(policy, "editor")).toBe("disallow");
  });

  it("accepts https origins and localhost, and refuses anything else", () => {
    const base = { ...DEFAULT_PASSKEY_POLICY };
    expect(PasskeyPolicySchema.safeParse({ ...base, extraOrigins: ["https://www.example.com/"] }).data?.extraOrigins).toEqual(["https://www.example.com"]);
    expect(PasskeyPolicySchema.safeParse({ ...base, extraOrigins: ["http://localhost:3000"] }).success).toBe(true);
    expect(PasskeyPolicySchema.safeParse({ ...base, extraOrigins: ["http://example.com"] }).success).toBe(false);
    expect(PasskeyPolicySchema.safeParse({ ...base, extraOrigins: ["https://example.com/path"] }).success).toBe(false);
    expect(PasskeyPolicySchema.safeParse({ ...base, rpId: "https://example.com" }).success).toBe(false);
    expect(PasskeyPolicySchema.safeParse({ ...base, allowedAaguids: ["not-a-guid"] }).success).toBe(false);
  });

  it("derives the relying party from the request, and ignores an RP ID the host is not within", () => {
    const request = { protocol: "https", hostname: "blog.example.com", host: "blog.example.com" };
    expect(resolveRelyingParty(DEFAULT_PASSKEY_POLICY, request)).toEqual({ rpId: "blog.example.com", origin: "https://blog.example.com", origins: ["https://blog.example.com"] });

    const parent = normalizePasskeyPolicy({ rpId: "example.com", extraOrigins: ["https://shop.example.com", "https://other.test"] });
    const rp = resolveRelyingParty(parent, request);
    expect(rp.rpId).toBe("example.com");
    expect(rp.origins).toEqual(["https://blog.example.com", "https://shop.example.com"]);

    const unrelated = normalizePasskeyPolicy({ rpId: "other.test" });
    expect(resolveRelyingParty(unrelated, request).rpId).toBe("blog.example.com");
  });

  it("keeps the port in the origin but not in the RP ID", () => {
    const rp = resolveRelyingParty(DEFAULT_PASSKEY_POLICY, { protocol: "http", hostname: "localhost", host: "localhost:3000" });
    expect(rp).toEqual({ rpId: "localhost", origin: "http://localhost:3000", origins: ["http://localhost:3000"] });
  });
});
