import { describe, it, expect } from "vitest";
import {
  COOKIE_CATEGORIES,
  CookieDeclarationSchema,
  resolveCookies,
  cookieNameMatches,
} from "./cookies.js";

describe("CookieDeclarationSchema", () => {
  it("accepts a well-formed declaration", () => {
    const parsed = CookieDeclarationSchema.parse({
      name: "_ga_*",
      category: "analytics",
      purpose: "Google Analytics session state",
      provider: "Google",
      duration: "13 months",
    });
    expect(parsed.category).toBe("analytics");
  });

  it("rejects an unknown category and a bad name", () => {
    expect(
      CookieDeclarationSchema.safeParse({ name: "x", category: "spy", purpose: "p" }).success,
    ).toBe(false);
    expect(
      CookieDeclarationSchema.safeParse({ name: "a b", category: "analytics", purpose: "p" })
        .success,
    ).toBe(false);
  });
});

describe("resolveCookies", () => {
  const declared = [
    { name: "jf_session", category: "necessary" as const, purpose: "auth", declaredBy: "core" },
    { name: "_ga", category: "analytics" as const, purpose: "GA", declaredBy: "acme.analytics" },
  ];

  it("applies operator overrides and marks them", () => {
    const out = resolveCookies(declared, { _ga: "marketing" });
    const ga = out.find((c) => c.name === "_ga")!;
    expect(ga.effectiveCategory).toBe("marketing");
    expect(ga.overridden).toBe(true);
    const session = out.find((c) => c.name === "jf_session")!;
    expect(session.effectiveCategory).toBe("necessary");
    expect(session.overridden).toBe(false);
  });

  it("lets a core declaration win over a plugin claiming the same name", () => {
    const out = resolveCookies([
      { name: "jf_csrf", category: "necessary" as const, purpose: "core", declaredBy: "core" },
      {
        name: "jf_csrf",
        category: "marketing" as const,
        purpose: "spoof",
        declaredBy: "evil.plugin",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.declaredBy).toBe("core");
    expect(out[0]!.category).toBe("necessary");
  });

  it("an override equal to the declared category is not flagged as overridden", () => {
    const [ga] = resolveCookies([declared[1]!], { _ga: "analytics" });
    expect(ga!.overridden).toBe(false);
  });
});

describe("cookieNameMatches", () => {
  it("matches exact names and prefix patterns", () => {
    expect(cookieNameMatches("_ga", "_ga")).toBe(true);
    expect(cookieNameMatches("_ga", "_gid")).toBe(false);
    expect(cookieNameMatches("_ga_*", "_ga_ABC123")).toBe(true);
    expect(cookieNameMatches("_ga_*", "_gat")).toBe(false);
  });
});

describe("COOKIE_CATEGORIES", () => {
  it("is the standard four", () => {
    expect([...COOKIE_CATEGORIES]).toEqual(["necessary", "preferences", "analytics", "marketing"]);
  });
});
