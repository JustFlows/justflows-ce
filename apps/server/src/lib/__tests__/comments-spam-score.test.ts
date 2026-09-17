// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { emailDomain, extractLinkDomains, scoreComment } from "../comments-spam-score.js";

function baseSignals(overrides: Partial<Parameters<typeof scoreComment>[0]> = {}) {
  return {
    linkCount: 0,
    linkThreshold: 2,
    plainText: "A perfectly normal comment about the article.",
    authorEmailDomain: "example.com",
    formToken: "ok" as const,
    trainedTermMatches: [],
    ...overrides,
  };
}

describe("scoreComment", () => {
  it("scores a clean comment at zero", () => {
    expect(scoreComment(baseSignals())).toEqual({ score: 0, reasons: [] });
  });

  it("penalizes links over the threshold", () => {
    const result = scoreComment(baseSignals({ linkCount: 5 }));
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons).toContain("links:5");
  });

  it("penalizes built-in spam keywords", () => {
    const result = scoreComment(baseSignals({ plainText: "buy cheap viagra and cialis now" }));
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons.some((r) => r.startsWith("keywords:"))).toBe(true);
  });

  it("penalizes a disposable email domain", () => {
    const result = scoreComment(baseSignals({ authorEmailDomain: "mailinator.com" }));
    expect(result.reasons).toContain("disposable_email");
  });

  it("penalizes a wall of the same repeated word", () => {
    const result = scoreComment(
      baseSignals({ plainText: Array(20).fill("spamword").join(" ") }),
    );
    expect(result.reasons).toContain("repetitive");
  });

  it("penalizes a missing or too-fast form token", () => {
    expect(scoreComment(baseSignals({ formToken: "missing" })).reasons).toContain(
      "form_token_missing",
    );
    const tooFast = scoreComment(baseSignals({ formToken: "tooFast" }));
    expect(tooFast.reasons).toContain("form_too_fast");
    expect(tooFast.score).toBeGreaterThan(
      scoreComment(baseSignals({ formToken: "missing" })).score,
    );
  });

  it("weighs in trained term matches (auto-trained or admin-added — same field)", () => {
    const result = scoreComment(
      baseSignals({ trainedTermMatches: [{ kind: "domain", value: "spam.example", weight: 10 }] }),
    );
    expect(result.reasons.some((r) => r.startsWith("trained:"))).toBe(true);
  });

  it("lets several matched trained/admin-added terms compound past a single term's weight", () => {
    // Five admin-added terms at weight 20 each (a real scenario: an operator
    // curates several known-bad phrases) must sum, not cap out at one
    // category's worth — multiple independent hits are stronger evidence,
    // not the same signal repeated.
    const matches = ["buy crypto", "sell crypto", "crypto", "cookie", "totally legit offer"].map(
      (value) => ({ kind: "phrase" as const, value, weight: 20 }),
    );
    const result = scoreComment(baseSignals({ trainedTermMatches: matches }));
    expect(result.score).toBe(100);
  });

  it("clamps the score to 0-100", () => {
    const result = scoreComment(
      baseSignals({
        linkCount: 50,
        plainText: "viagra cialis casino porn xxx forex " + Array(30).fill("aaaa").join(" "),
        authorEmailDomain: "mailinator.com",
        formToken: "tooFast",
        trainedTermMatches: [{ kind: "phrase", value: "x", weight: 1000 }],
      }),
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe("extractLinkDomains", () => {
  it("extracts unique lowercase hostnames", () => {
    const html = '<p>see <a href="https://Example.com/a">a</a> and http://example.com/b and https://other.test</p>';
    expect(extractLinkDomains(html).sort()).toEqual(["example.com", "other.test"]);
  });

  it("ignores malformed URLs instead of throwing", () => {
    expect(extractLinkDomains("https://[[[not a url")).toEqual([]);
  });
});

describe("emailDomain", () => {
  it("extracts the domain, lowercased", () => {
    expect(emailDomain("User@Example.COM")).toBe("example.com");
  });

  it("returns null when there is no @", () => {
    expect(emailDomain("not-an-email")).toBeNull();
  });
});
