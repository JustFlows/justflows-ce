// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMENT_SETTINGS,
  commentsStateFor,
  normalizeCommentSettings,
  readCommentsOverride,
  toPublicCommentSettings,
} from "../comments-settings.js";

const enabled = { ...DEFAULT_COMMENT_SETTINGS, enabled: true };

describe("normalizeCommentSettings", () => {
  it("fills defaults and clamps out-of-range numbers", () => {
    const s = normalizeCommentSettings({ maxLength: 5_000_000, threadMaxDepth: 99, pageSize: 0 });
    expect(s.maxLength).toBe(20_000);
    expect(s.threadMaxDepth).toBe(10);
    expect(s.pageSize).toBe(5);
    expect(s.enabled).toBe(false);
    expect(s.requireModeration).toBe(true);
  });

  it("rejects an unknown captcha provider", () => {
    expect(normalizeCommentSettings({ captchaProvider: "unknown" }).captchaProvider).toBe("none");
    expect(normalizeCommentSettings({ captchaProvider: "turnstile" }).captchaProvider).toBe("turnstile");
    expect(normalizeCommentSettings({ captchaProvider: "recaptcha" }).captchaProvider).toBe("recaptcha");
  });
});

describe("toPublicCommentSettings", () => {
  it("replaces the secret with a boolean flag", () => {
    const pub = toPublicCommentSettings({ ...enabled, captchaSecretKey: "s3cr3t" });
    expect(pub).not.toHaveProperty("captchaSecretKey");
    expect(pub.captchaSecretKeySet).toBe(true);
    expect(toPublicCommentSettings(enabled).captchaSecretKeySet).toBe(false);
  });
});

describe("readCommentsOverride", () => {
  it("reads the per-content field, defaulting to inherit", () => {
    expect(readCommentsOverride({ comments: "open" })).toBe("open");
    expect(readCommentsOverride({ comments: "closed" })).toBe("closed");
    expect(readCommentsOverride({ comments: "nonsense" })).toBe("inherit");
    expect(readCommentsOverride(null)).toBe("inherit");
  });
});

describe("commentsStateFor", () => {
  it("keeps a placed block visible but closes the form when the site switch is off", () => {
    expect(commentsStateFor({ fields: {} }, DEFAULT_COMMENT_SETTINGS)).toEqual({
      visible: true,
      accepting: false,
    });
  });

  it("an 'open' override opens the form even with the site switch off", () => {
    expect(commentsStateFor({ fields: { comments: "open" } }, DEFAULT_COMMENT_SETTINGS)).toEqual({
      visible: true,
      accepting: true,
    });
  });

  it("a 'closed' override shows the thread but not the form", () => {
    expect(commentsStateFor({ fields: { comments: "closed" } }, enabled)).toEqual({
      visible: true,
      accepting: false,
    });
  });

  it("opens the form once the site switch is on", () => {
    expect(commentsStateFor({ fields: {} }, enabled)).toEqual({
      visible: true,
      accepting: true,
    });
  });

  it("closeAfterDays stops new comments once the post is old enough", () => {
    const settings = { ...enabled, closeAfterDays: 30 };
    const now = new Date("2026-03-01T00:00:00Z");
    const fresh = commentsStateFor(
      { fields: {}, publishedAt: "2026-02-20T00:00:00Z" },
      settings,
      now,
    );
    const stale = commentsStateFor(
      { fields: {}, publishedAt: "2026-01-01T00:00:00Z" },
      settings,
      now,
    );
    expect(fresh).toEqual({ visible: true, accepting: true });
    expect(stale).toEqual({ visible: true, accepting: false });
  });

  it("a per-content 'open' override beats closeAfterDays", () => {
    const settings = { ...enabled, closeAfterDays: 1 };
    const state = commentsStateFor(
      { fields: { comments: "open" }, publishedAt: "2000-01-01T00:00:00Z" },
      settings,
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(state).toEqual({ visible: true, accepting: true });
  });
});
