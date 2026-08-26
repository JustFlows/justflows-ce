import { describe, expect, it } from "vitest";
import { buildSecurityTxt, securityTxtExpiry } from "../security-txt.js";

/** Parse the field/value pairs, ignoring comments and blanks. */
function fields(txt: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of txt.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    const name = trimmed.slice(0, idx).trim();
    (out[name] ??= []).push(trimmed.slice(idx + 1).trim());
  }
  return out;
}

const NOW = new Date("2026-08-26T00:00:00Z");

describe("RFC 9116 compliance", () => {
  const txt = buildSecurityTxt("https://example.com", NOW);
  const f = fields(txt);

  // §2.5.5 — REQUIRED. Its absence is what makes a file invalid rather than
  // merely incomplete, and it was missing entirely.
  it("carries exactly one Expires field", () => {
    expect(f.Expires).toHaveLength(1);
  });

  it("expresses Expires as an ISO 8601 instant in the future", () => {
    const expires = new Date(f.Expires![0]!);
    expect(Number.isNaN(expires.getTime())).toBe(false);
    expect(expires.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("keeps Expires under a year out, as the RFC recommends", () => {
    const days = (new Date(f.Expires![0]!).getTime() - NOW.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(30);
    expect(days).toBeLessThan(365);
  });

  it("has at least one Contact, which is REQUIRED", () => {
    expect(f.Contact?.length).toBeGreaterThanOrEqual(1);
    expect(f.Contact![0]).toMatch(/^(mailto:|https:)/);
  });

  // §2.5.2 — Canonical is a URI. A bare path is not one.
  it("makes Canonical an absolute URI", () => {
    expect(f.Canonical).toHaveLength(1);
    expect(() => new URL(f.Canonical![0]!)).not.toThrow();
    expect(f.Canonical![0]).toBe("https://example.com/.well-known/security.txt");
  });

  it("points Policy at the repository actually being served", () => {
    expect(f.Policy![0]).toBe(
      "https://github.com/JustFlows/justflows-ce/blob/main/SECURITY.md",
    );
  });
});

describe("without a configured APP_URL", () => {
  const txt = buildSecurityTxt("", NOW);
  const f = fields(txt);

  it("still carries the required fields", () => {
    expect(f.Contact?.length).toBe(1);
    expect(f.Expires?.length).toBe(1);
  });

  it("omits Canonical rather than emitting a relative one", () => {
    // A wrong absolute URI is worse than an absent optional field.
    expect(f.Canonical).toBeUndefined();
    expect(txt).not.toContain("Canonical: /");
  });
});

describe("freshness", () => {
  it("moves with the clock, so a long-lived process cannot serve a stale file", () => {
    const a = securityTxtExpiry(new Date("2026-01-01T00:00:00Z"));
    const b = securityTxtExpiry(new Date("2026-06-01T00:00:00Z"));
    expect(new Date(b).getTime()).toBeGreaterThan(new Date(a).getTime());
  });
});
