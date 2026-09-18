// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const run = vi.fn();
vi.mock("../../../src/lib/database/db.js", () => ({ getDb: async () => ({ query, run }) }));

const { auditLog } = vi.hoisted(() => ({ auditLog: vi.fn() }));
vi.mock("../../../src/lib/security/audit-log.js", () => ({ auditLog }));

vi.mock("../../../src/lib/comments/comments-public.js", () => ({
  // Strip to a fixed point rather than a single pass — a single `<[^>]+>`
  // pass leaves a remnant for malformed/nested markup (e.g. "<<script>x>"),
  // which is exactly what CodeQL's incomplete-sanitization check flags.
  commentPlainText: (html: string) => {
    let text = html;
    let previous: string;
    do {
      previous = text;
      text = text.replace(/<[^>]*>/g, "");
    } while (text !== previous);
    return text.trim();
  },
}));

import {
  addRule,
  addSpamTerm,
  matchRules,
  matchTrainedTerms,
  removeRule,
  removeSpamTerm,
  trainFromMark,
} from "../../../src/lib/comments/comments-rules.js";

const actor = { siteId: "site-1", userId: "user-1", role: "administrator" };

beforeEach(() => {
  query.mockReset();
  run.mockReset().mockResolvedValue(undefined);
  auditLog.mockReset();
});

describe("matchRules", () => {
  function rule(overrides: Record<string, unknown>) {
    return {
      id: "r1",
      list: "block",
      field: "phrase",
      pattern: "spamword",
      note: null,
      created_by: null,
      created_at: "2026-01-01",
      hit_count: 0,
      last_hit_at: null,
      ...overrides,
    };
  }

  const input = {
    authorEmail: "bad@spam.example",
    authorEmailDomain: "spam.example",
    linkDomains: ["links.example"],
    ip: "203.0.113.9",
    plainText: "this has spamword in it",
  };

  it("matches a block phrase rule and records a hit", async () => {
    query.mockImplementation(async (sql: string) =>
      /FROM comment_moderation_rules/i.test(sql) ? [rule({})] : [],
    );
    const result = await matchRules("site-1", input);
    expect(result?.list).toBe("block");
    expect(run).toHaveBeenCalledWith(expect.stringMatching(/UPDATE comment_moderation_rules/i), [
      expect.any(String),
      "r1",
    ]);
  });

  it("lets an allow rule win over a matching block rule", async () => {
    query.mockImplementation(async (sql: string) =>
      /FROM comment_moderation_rules/i.test(sql)
        ? [rule({ id: "block-1" }), rule({ id: "allow-1", list: "allow" })]
        : [],
    );
    const result = await matchRules("site-1", input);
    expect(result?.list).toBe("allow");
    expect(result?.rule.id).toBe("allow-1");
  });

  it("matches an author_domain rule by suffix, including link domains", async () => {
    query.mockImplementation(async (sql: string) =>
      /FROM comment_moderation_rules/i.test(sql)
        ? [rule({ field: "author_domain", pattern: "example" })]
        : [],
    );
    expect(
      await matchRules("site-1", { ...input, authorEmailDomain: "mail.example", linkDomains: [] }),
    ).toBeTruthy();
    expect(
      await matchRules("site-1", { ...input, authorEmailDomain: "other.test", linkDomains: ["a.example"] }),
    ).toBeTruthy();
    expect(
      await matchRules("site-1", { ...input, authorEmailDomain: "other.test", linkDomains: ["other.test"] }),
    ).toBeNull();
  });

  it("matches an ip rule by exact value or dotted prefix", async () => {
    query.mockImplementation(async (sql: string) =>
      /FROM comment_moderation_rules/i.test(sql)
        ? [rule({ field: "ip", pattern: "203.0.113." })]
        : [],
    );
    expect(await matchRules("site-1", input)).toBeTruthy();
    expect(await matchRules("site-1", { ...input, ip: "198.51.100.1" })).toBeNull();
  });

  it("returns null when nothing matches", async () => {
    query.mockImplementation(async (sql: string) =>
      /FROM comment_moderation_rules/i.test(sql) ? [rule({ pattern: "unrelated" })] : [],
    );
    expect(await matchRules("site-1", input)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("addRule / removeRule", () => {
  it("inserts a rule, lowercases non-IP patterns, and audits it", async () => {
    query.mockResolvedValueOnce([
      { id: "new-id", list: "block", field: "author_email", pattern: "spammer@example.com", note: null, hit_count: 0 },
    ]);
    const rule = await addRule(actor, { list: "block", field: "author_email", pattern: "Spammer@Example.com" });
    expect(rule.id).toBe("new-id");
    const insert = run.mock.calls.find(([sql]) => /INSERT INTO comment_moderation_rules/i.test(sql))!;
    expect(insert[1]).toContain("spammer@example.com");
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "comment.rule_added" }));
  });

  it("preserves case for an IP pattern", async () => {
    query.mockResolvedValueOnce([{ id: "new-id", list: "block", field: "ip", pattern: "203.0.113.", hit_count: 0 }]);
    await addRule(actor, { list: "block", field: "ip", pattern: "203.0.113." });
    const insert = run.mock.calls.find(([sql]) => /INSERT INTO comment_moderation_rules/i.test(sql))!;
    expect(insert[1]).toContain("203.0.113.");
  });

  it("rejects an empty pattern", async () => {
    await expect(addRule(actor, { list: "block", field: "phrase", pattern: "   " })).rejects.toThrow();
  });

  it("removes an existing rule and audits it", async () => {
    query.mockResolvedValueOnce([{ id: "r1" }]);
    expect(await removeRule(actor, "r1")).toBe(true);
    expect(run).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM comment_moderation_rules/i), [
      "r1",
      actor.siteId,
    ]);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "comment.rule_removed" }));
  });

  it("returns false for a rule that does not exist, without auditing", async () => {
    query.mockResolvedValueOnce([]);
    expect(await removeRule(actor, "nope")).toBe(false);
    expect(auditLog).not.toHaveBeenCalled();
  });
});

describe("trainFromMark / matchTrainedTerms", () => {
  it("upserts a new term on first spam mark", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/SELECT body FROM comments/i.test(sql)) {
        return [{ body: '<p>buy now at https://spammy.example/deal repeat repeat repeat repeat</p>' }];
      }
      if (/SELECT id, weight, hits, source FROM comment_spam_terms/i.test(sql)) return [];
      return [];
    });
    await trainFromMark("site-1", "c1", "spam");
    const inserts = run.mock.calls.filter(([sql]) => /INSERT INTO comment_spam_terms/i.test(sql));
    expect(inserts.some((call) => call[1].includes("spammy.example"))).toBe(true);
    expect(inserts.every(([sql]) => /'trained'/.test(sql))).toBe(true);
  });

  it("decrements weight, floored at zero, when unmarking spam", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/SELECT body FROM comments/i.test(sql)) return [{ body: "<p>https://spammy.example</p>" }];
      if (/SELECT id, weight, hits, source FROM comment_spam_terms/i.test(sql)) {
        return [{ id: "term-1", weight: 0.5, hits: 1, source: "trained" }];
      }
      return [];
    });
    await trainFromMark("site-1", "c1", "unspam");
    const update = run.mock.calls.find(([sql]) => /UPDATE comment_spam_terms/i.test(sql))!;
    expect(update[1][0]).toBe(0);
  });

  it("never resizes or shadows an admin-added (manual) term", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/SELECT body FROM comments/i.test(sql)) return [{ body: "<p>https://spammy.example</p>" }];
      if (/SELECT id, weight, hits, source FROM comment_spam_terms/i.test(sql)) {
        return [{ id: "term-1", weight: 20, hits: 0, source: "manual" }];
      }
      return [];
    });
    await trainFromMark("site-1", "c1", "spam");
    expect(run.mock.calls.some(([sql]) => /(INSERT|UPDATE) .*comment_spam_terms/i.test(sql))).toBe(false);
  });

  it("does nothing when the comment no longer exists", async () => {
    query.mockResolvedValueOnce([]);
    await trainFromMark("site-1", "gone", "spam");
    expect(run).not.toHaveBeenCalled();
  });

  it("matches only positive-weight trained terms present in the submission", async () => {
    query.mockResolvedValue([
      { kind: "domain", value: "spammy.example", weight: 3 },
      { kind: "phrase", value: "cheapdeal", weight: 2 },
    ]);
    const matches = await matchTrainedTerms("site-1", ["spammy.example"], "totally a cheapdeal here");
    expect(matches).toEqual([
      { kind: "domain", value: "spammy.example", weight: 3 },
      { kind: "phrase", value: "cheapdeal", weight: 2 },
    ]);
    expect(await matchTrainedTerms("site-1", ["other.example"], "nothing to see")).toEqual([]);
  });
});

describe("addSpamTerm / removeSpamTerm", () => {
  it("inserts a new manual term at the fixed weight and audits it", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/SELECT id FROM comment_spam_terms/i.test(sql)) return [];
      if (/SELECT \* FROM comment_spam_terms WHERE id/i.test(sql)) {
        return [{ id: "term-1", kind: "phrase", value: "free crypto", weight: 20, hits: 0, source: "manual" }];
      }
      return [];
    });
    const term = await addSpamTerm(actor, { kind: "phrase", value: "Free Crypto" });
    expect(term).toMatchObject({ id: "term-1", kind: "phrase", value: "free crypto", weight: 20, source: "manual" });
    const insert = run.mock.calls.find(([sql]) => /INSERT INTO comment_spam_terms/i.test(sql))!;
    expect(insert[1]).toContain("free crypto");
    expect(insert[1]).toContain(20);
    expect(insert[0]).toMatch(/'manual'/);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "comment.spam_term_added" }));
  });

  it("rejects an empty value", async () => {
    await expect(addSpamTerm(actor, { kind: "phrase", value: "   " })).rejects.toThrow();
  });

  it("promotes an existing (e.g. auto-trained) term to manual on re-add", async () => {
    query.mockImplementation(async (sql: string) => {
      if (/SELECT id FROM comment_spam_terms/i.test(sql)) return [{ id: "term-1" }];
      if (/SELECT \* FROM comment_spam_terms WHERE id/i.test(sql)) {
        return [{ id: "term-1", kind: "domain", value: "spammy.example", weight: 20, hits: 3, source: "manual" }];
      }
      return [];
    });
    await addSpamTerm(actor, { kind: "domain", value: "spammy.example" });
    const update = run.mock.calls.find(([sql]) => /UPDATE comment_spam_terms SET source = 'manual'/i.test(sql))!;
    expect(update[1]).toEqual([20, expect.any(String), "term-1"]);
  });

  it("removes a term regardless of source and audits it", async () => {
    query.mockResolvedValueOnce([{ id: "term-1" }]);
    expect(await removeSpamTerm(actor, "term-1")).toBe(true);
    expect(run).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM comment_spam_terms/i), [
      "term-1",
      actor.siteId,
    ]);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "comment.spam_term_removed" }));
  });

  it("returns false for a term that does not exist, without auditing", async () => {
    query.mockResolvedValueOnce([]);
    expect(await removeSpamTerm(actor, "nope")).toBe(false);
    expect(auditLog).not.toHaveBeenCalled();
  });
});
