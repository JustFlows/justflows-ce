// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const run = vi.fn();

vi.mock("../db.js", () => ({ getDb: async () => ({ query, run }) }));

const settings = {
  enabled: true,
  requireModeration: true,
  closeAfterDays: 0,
  allowUrls: true,
  notifyModerator: false,
  maxLength: 5000,
  threadMaxDepth: 6,
  pageSize: 50,
  captchaProvider: "none" as const,
  captchaSiteKey: "",
  captchaSecretKey: "",
};

vi.mock("../comments-settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../comments-settings.js")>();
  return { ...actual, getCommentSettings: async () => ({ ...settings }) };
});

vi.mock("../general-settings.js", () => ({
  getGeneralSettings: async () => ({ adminEmail: "admin@example.com" }),
}));

const sendMail = vi.fn().mockResolvedValue({ ok: true });
vi.mock("../mail.js", () => ({ sendMail }));

import { acceptCommentSubmission, renderCommentsBlockHtml, clearCommentNotify } from "../comments-public.js";
import { resetRateLimits } from "../rate-limit.js";

const PUBLISHED_POST = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "post",
  status: "published",
  published_at: "2026-01-01 00:00:00",
  fields: {},
};

/** Route queries by a fragment of their SQL. */
function routeQuery(overrides: Record<string, unknown[]> = {}) {
  query.mockImplementation(async (sql: string) => {
    if (/FROM sites/i.test(sql)) return overrides.sites ?? [{ id: "site-1" }];
    if (/FROM content WHERE id/i.test(sql)) return overrides.content ?? [PUBLISHED_POST];
    if (/FROM comments WHERE id = \? AND site_id = \? LIMIT 1/i.test(sql) && /parent_id, status, content_id/i.test(sql))
      return overrides.parent ?? [];
    if (/FROM comments WHERE id = \? AND site_id = \? LIMIT 1/i.test(sql) && /SELECT parent_id/i.test(sql))
      return overrides.depth ?? [{ parent_id: null }];
    if (/FROM users WHERE id/i.test(sql)) return overrides.user ?? [];
    if (/FROM comments\s+WHERE site_id = \? AND content_id = \? AND status = 'approved'/i.test(sql))
      return overrides.approved ?? [];
    if (/unsubscribe_token = \? LIMIT 1/i.test(sql)) return overrides.unsub ?? [{ id: "c1" }];
    return [];
  });
}

const base = {
  host: "example.com",
  origin: "https://example.com",
  referer: "https://example.com/hello",
  clientIp: "203.0.113.9",
};

beforeEach(() => {
  query.mockReset();
  run.mockReset();
  sendMail.mockClear();
  resetRateLimits();
  Object.assign(settings, {
    enabled: true,
    requireModeration: true,
    captchaProvider: "none",
    captchaSiteKey: "",
    captchaSecretKey: "",
    closeAfterDays: 0,
  });
  routeQuery();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function form(extra: Record<string, unknown> = {}) {
  return {
    body: {
      content_id: PUBLISHED_POST.id,
      author_name: "Ada",
      author_email: "ada@example.com",
      body: "Hello there, nice post!",
      return_to: "/hello",
      ...extra,
    },
    ...base,
  };
}

describe("acceptCommentSubmission", () => {
  it("rejects a cross-origin submission", async () => {
    const res = await acceptCommentSubmission({ ...form(), origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("silently drops a honeypot hit without inserting", async () => {
    const res = await acceptCommentSubmission(form({ website_url: "http://spam.example" }));
    expect(res.status).toBe(303);
    expect(run).not.toHaveBeenCalled();
  });

  it("rate limits after five submissions from one IP", async () => {
    for (let i = 0; i < 5; i++) expect((await acceptCommentSubmission(form())).status).toBe(303);
    expect((await acceptCommentSubmission(form())).status).toBe(429);
  });

  it("stores a comment as pending when moderation is on", async () => {
    const res = await acceptCommentSubmission(form());
    expect(res.status).toBe(303);
    expect(res.location).toContain("comment=pending");
    const insert = run.mock.calls.find(([sql]) => /INSERT INTO comments/i.test(sql));
    expect(insert).toBeTruthy();
    expect(insert![1]).toContain("pending");
  });

  it("auto-approves when moderation is off", async () => {
    settings.requireModeration = false;
    const res = await acceptCommentSubmission(form());
    expect(res.location).toContain("comment=posted");
    const insert = run.mock.calls.find(([sql]) => /INSERT INTO comments/i.test(sql));
    expect(insert![1]).toContain("approved");
  });

  it("strips scripting from the body before storing", async () => {
    await acceptCommentSubmission(form({ body: "hi <script>alert(1)</script> <b>ok</b>" }));
    const insert = run.mock.calls.find(([sql]) => /INSERT INTO comments/i.test(sql))!;
    const storedBody = String(insert[1][7]);
    expect(storedBody).not.toMatch(/<script/i);
    expect(storedBody).not.toMatch(/alert\(1\)/);
  });

  it("rejects an invalid email address", async () => {
    const res = await acceptCommentSubmission(form({ author_email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a reply to an unknown parent", async () => {
    const res = await acceptCommentSubmission(form({ parent_id: "22222222-2222-2222-2222-222222222222" }));
    expect(res.status).toBe(400);
  });

  it("fails the CAPTCHA when the token does not verify", async () => {
    settings.captchaProvider = "turnstile";
    settings.captchaSiteKey = "site";
    settings.captchaSecretKey = "secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }),
    );
    const res = await acceptCommentSubmission(form({ "cf-turnstile-response": "bad" }));
    expect(res.status).toBe(400);
    expect(res.location).toContain("comment=captcha");
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses when comments are closed for the post", async () => {
    routeQuery({ content: [{ ...PUBLISHED_POST, fields: { comments: "closed" } }] });
    const res = await acceptCommentSubmission(form());
    expect(res.status).toBe(403);
  });
});

describe("renderCommentsBlockHtml", () => {
  const ctx = {
    siteId: "site-1",
    content: { id: PUBLISHED_POST.id, type: "post", publishedAt: PUBLISHED_POST.published_at, fields: {} },
    currentUser: null,
    banner: null,
    replyTo: null,
    page: 1,
    basePath: "/hello",
    locale: "en",
    t: (k: string) => k,
  };

  it("never leaks commenter email or IP into the public markup", async () => {
    routeQuery({
      approved: [
        {
          id: "c-1",
          parent_id: null,
          author_name: "Ada <script>",
          author_url: null,
          body: "<p>hello</p>",
          created_at: "2026-02-02 00:00:00",
          edited_at: null,
        },
      ],
    });
    const html = await renderCommentsBlockHtml({}, ctx);
    expect(html).not.toMatch(/@example\.com/);
    expect(html).not.toMatch(/203\.0\.113/);
    // The approved-thread query must not even select these columns.
    const threadQuery = query.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => /status = 'approved'/.test(sql))!;
    expect(threadQuery).not.toMatch(/author_email/);
    expect(threadQuery).not.toMatch(/ip_address/);
    expect(html).toContain("Ada &lt;script&gt;");
    expect(html).toContain('id="jf-comment-form"');
  });

  it("shows a closed notice instead of the form when comments are disabled", async () => {
    settings.enabled = false;
    routeQuery();
    const html = await renderCommentsBlockHtml({}, ctx);
    settings.enabled = true;
    expect(html).toContain("jf-comments");
    expect(html).not.toContain('id="jf-comment-form"');
    expect(html).toContain("comments.closed");
  });
});

describe("clearCommentNotify", () => {
  it("clears notify for a known token", async () => {
    routeQuery();
    const ok = await clearCommentNotify("abc123");
    expect(ok).toBe(true);
    expect(run).toHaveBeenCalledWith(expect.stringMatching(/UPDATE comments SET notify/i), [false, "abc123"]);
  });

  it("rejects an unknown token", async () => {
    routeQuery({ unsub: [] });
    expect(await clearCommentNotify("nope")).toBe(false);
  });
});
