// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COMMENT_SETTINGS, type CommentSettings } from "../comments-settings.js";

const { matchRules, matchTrainedTerms, query, hooks } = vi.hoisted(() => ({
  matchRules: vi.fn(async () => null as { list: "block" | "allow"; rule: unknown } | null),
  matchTrainedTerms: vi.fn(async () => [] as unknown[]),
  query: vi.fn(async () => [] as unknown[]),
  hooks: { has: vi.fn(() => false), applyFilter: vi.fn(async (_h: string, v: unknown) => v) },
}));

vi.mock("../comments-rules.js", () => ({ matchRules, matchTrainedTerms }));
vi.mock("../db.js", () => ({ getDb: async () => ({ query }) }));
vi.mock("../plugin-runtime.js", () => ({
  ensurePluginRuntime: async () => {},
  getRuntimeHooks: () => hooks,
}));

import { decide } from "../comments-spam-policy.js";

function settings(overrides: Partial<CommentSettings> = {}): CommentSettings {
  return { ...DEFAULT_COMMENT_SETTINGS, ...overrides };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    siteId: "site-1",
    contentId: "content-1",
    ip: "203.0.113.9",
    userAgent: "test-agent",
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authorUrl: "",
    bodyHtml: "<p>A perfectly normal comment.</p>",
    plainText: "A perfectly normal comment.",
    userId: null,
    isAuthenticated: false,
    formToken: "ok" as const,
    settings: settings(),
    ...overrides,
  };
}

beforeEach(() => {
  matchRules.mockReset().mockResolvedValue(null);
  matchTrainedTerms.mockReset().mockResolvedValue([]);
  query.mockReset().mockResolvedValue([]);
  hooks.has.mockReset().mockReturnValue(false);
  hooks.applyFilter.mockReset().mockImplementation(async (_h: string, v: unknown) => v);
});

describe("decide", () => {
  it("auto-marks spam on a block-rule hit, regardless of the score", async () => {
    matchRules.mockResolvedValue({ list: "block", rule: { field: "phrase" } });
    const result = await decide(input());
    expect(result.status).toBe("spam");
    expect(result.heldReason).toBe("blocklist");
    expect(result.score).toBe(100);
  });

  it("approves on an allow-rule hit even with spammy content", async () => {
    matchRules.mockResolvedValue({ list: "allow", rule: { field: "author_email" } });
    const result = await decide(
      input({
        bodyHtml: "buy viagra cialis casino now",
        plainText: "buy viagra cialis casino now",
        settings: settings({ requireModeration: true }),
      }),
    );
    expect(result.status).toBe("approved");
  });

  it("marks spam when the external backend returns a spam verdict", async () => {
    hooks.has.mockReturnValue(true);
    hooks.applyFilter.mockResolvedValue({
      id: "acme-spam",
      check: async () => ({ verdict: "spam", reason: "known_bad_actor" }),
    });
    const result = await decide(input());
    expect(result.status).toBe("spam");
    expect(result.heldReason).toBe("external_spam");
  });

  it("nudges the score up on a 'review' verdict from the external backend", async () => {
    hooks.has.mockReturnValue(true);
    hooks.applyFilter.mockResolvedValue({
      id: "acme-spam",
      check: async () => ({ verdict: "review" }),
    });
    const withReview = await decide(input({ settings: settings({ spamHoldThreshold: 15 }) }));
    expect(withReview.score).toBeGreaterThanOrEqual(20);
    expect(withReview.status).toBe("pending");
  });

  it("never lets a throwing external backend block the submission", async () => {
    hooks.has.mockReturnValue(true);
    hooks.applyFilter.mockResolvedValue({
      id: "flaky",
      check: async () => {
        throw new Error("timeout");
      },
    });
    const result = await decide(input({ settings: settings({ requireModeration: false }) }));
    expect(result.status).toBe("approved");
  });

  it("auto-spams above the reject threshold from the local score", async () => {
    const result = await decide(
      input({
        bodyHtml: "https://a.example https://b.example https://c.example https://d.example",
        plainText: "viagra cialis casino forex loan approved click here now",
        settings: settings({ spamHoldThreshold: 10, spamRejectThreshold: 30, requireModeration: false }),
      }),
    );
    expect(result.status).toBe("spam");
    expect(result.heldReason).toBe("score");
  });

  it("holds for moderation between the hold and reject thresholds", async () => {
    const result = await decide(
      input({
        plainText: "viagra deal",
        settings: settings({ spamHoldThreshold: 5, spamRejectThreshold: 90, requireModeration: false }),
      }),
    );
    expect(result.status).toBe("pending");
    expect(result.heldReason).toBe("score");
  });

  it("holds for plain moderation when the score is low but requireModeration is on", async () => {
    const result = await decide(input({ settings: settings({ requireModeration: true }) }));
    expect(result.status).toBe("pending");
    expect(result.heldReason).toBe("moderation");
  });

  it("approves a clean, low-score comment when moderation is off", async () => {
    const result = await decide(input({ settings: settings({ requireModeration: false }) }));
    expect(result.status).toBe("approved");
    expect(result.heldReason).toBeNull();
  });

  it("holds a first-time commenter's comment when firstCommentHold is on", async () => {
    query.mockResolvedValue([]); // no prior approved comment
    const result = await decide(
      input({ settings: settings({ requireModeration: false, firstCommentHold: true }) }),
    );
    expect(result.status).toBe("pending");
    expect(result.heldReason).toBe("first_time");
  });

  it("does not hold a returning commenter when firstCommentHold is on", async () => {
    query.mockResolvedValue([{ id: "prior-comment" }]);
    const result = await decide(
      input({ settings: settings({ requireModeration: false, firstCommentHold: true }) }),
    );
    expect(result.status).toBe("approved");
  });

  it("auto-approves a previously-approved author even when moderation is on", async () => {
    query.mockResolvedValue([{ id: "prior-comment" }]);
    const result = await decide(
      input({ settings: settings({ requireModeration: true, autoApprovePreviouslyApproved: true }) }),
    );
    expect(result.status).toBe("approved");
    expect(result.heldReason).toBeNull();
  });

  it("does not auto-approve a first-time author under the same setting", async () => {
    query.mockResolvedValue([]);
    const result = await decide(
      input({ settings: settings({ requireModeration: true, autoApprovePreviouslyApproved: true }) }),
    );
    expect(result.status).toBe("pending");
  });
});
