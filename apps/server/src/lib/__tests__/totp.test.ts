import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  matchRecoveryCode,
  totpCode,
  totpUri,
  TOTP_PERIOD_SECONDS,
  verifyTotp,
} from "../totp.js";

/** RFC 6238 Appendix B, SHA-1 seed "12345678901234567890". */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("TOTP against RFC 6238 test vectors", () => {
  // The published vectors are 8 digits; ours are the standard 6, so compare the
  // last six — the truncation is the same, only the modulus differs.
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  for (const [seconds, expected] of vectors) {
    it(`matches the vector at T=${seconds}`, () => {
      const counter = Math.floor(seconds / TOTP_PERIOD_SECONDS);
      expect(totpCode(RFC_SECRET, counter)).toBe(expected.slice(-6));
    });
  }
});

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    for (const text of ["", "a", "ab", "abc", "abcd", "abcde", "hello world"]) {
      const buf = Buffer.from(text, "utf8");
      expect(base32Decode(base32Encode(buf)).toString("utf8")).toBe(text);
    }
  });

  it("rejects a secret with characters outside the alphabet", () => {
    expect(() => base32Decode("ABC!1")).toThrow();
  });
});

describe("verifyTotp", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;

  it("accepts the current code", () => {
    const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
    expect(verifyTotp(secret, totpCode(secret, counter), now)).toBe(true);
  });

  it("absorbs one step of clock drift in both directions", () => {
    const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
    expect(verifyTotp(secret, totpCode(secret, counter - 1), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, counter + 1), now)).toBe(true);
  });

  it("rejects a code two steps away", () => {
    const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
    expect(verifyTotp(secret, totpCode(secret, counter - 2), now)).toBe(false);
    expect(verifyTotp(secret, totpCode(secret, counter + 2), now)).toBe(false);
  });

  it("rejects anything that is not six digits", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 56", "０００００"]) {
      expect(verifyTotp(secret, bad, now)).toBe(false);
    }
  });

  it("rejects a malformed secret rather than throwing", () => {
    expect(verifyTotp("not-base32!", "123456", now)).toBe(false);
  });

  it("tolerates whitespace in the entered code", () => {
    const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
    const code = totpCode(secret, counter);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(true);
  });
});

describe("secrets and enrolment URI", () => {
  it("mints a 160-bit secret", () => {
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it("mints a different secret each time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(seen.size).toBe(50);
  });

  it("builds an otpauth URI an authenticator can read", () => {
    const uri = new URL(totpUri("ABCDEF", "person@example.com", "My Site"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.searchParams.get("secret")).toBe("ABCDEF");
    expect(uri.searchParams.get("issuer")).toBe("My Site");
    expect(uri.searchParams.get("digits")).toBe("6");
    // The label carries issuer and account, both percent-encoded.
    expect(uri.pathname).toContain("My%20Site");
    expect(uri.pathname).toContain("person%40example.com");
  });
});

describe("recovery codes", () => {
  it("mints ten distinct codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it("omits characters that are misread when written down", () => {
    for (const code of generateRecoveryCodes(200)) {
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it("matches regardless of case and separators", () => {
    const codes = generateRecoveryCodes();
    const target = codes[3]!;
    expect(matchRecoveryCode(codes, target)).toBe(3);
    expect(matchRecoveryCode(codes, target.toLowerCase())).toBe(3);
    expect(matchRecoveryCode(codes, target.replace("-", ""))).toBe(3);
    expect(matchRecoveryCode(codes, target.replace("-", " "))).toBe(3);
  });

  it("reports no match for an unknown code", () => {
    expect(matchRecoveryCode(generateRecoveryCodes(), "ZZZZZ-ZZZZZ")).toBe(-1);
  });

  it("does not match the empty string against a list", () => {
    expect(matchRecoveryCode(generateRecoveryCodes(), "")).toBe(-1);
  });
});
