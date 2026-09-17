// SPDX-License-Identifier: MIT

import { decryptSecret, encryptSecret } from "./secret-box.js";
import { getSiteId, getSiteSetting, setSiteSetting } from "./site-settings.js";

export type CaptchaProvider =
  | "none"
  | "turnstile"
  | "hcaptcha"
  | "recaptcha"
  | "recaptcha-v3";

export interface CommentSettings {
  /** Site-wide master switch. The feature is opt-in. */
  enabled: boolean;
  /** New comments land as `pending` until an editor approves them. */
  requireModeration: boolean;
  /** Stop accepting new comments this many days after a post is published. 0 = never. */
  closeAfterDays: number;
  /** Render `author_url` as a `rel="nofollow ugc"` link. */
  allowUrls: boolean;
  /** Email the site admin when a comment needs moderation. */
  notifyModerator: boolean;
  /** Hard ceiling on a comment body, in characters. */
  maxLength: number;
  /** Replies deeper than this render at this depth rather than nesting further. */
  threadMaxDepth: number;
  /** Top-level comments shown per page in the public thread. */
  pageSize: number;
  captchaProvider: CaptchaProvider;
  captchaSiteKey: string;
  /** Minimum accepted Google reCAPTCHA v3 score. */
  captchaScoreThreshold: number;
  /** Never sent to the browser — see {@link toPublicCommentSettings}. */
  captchaSecretKey: string;
  /** Heuristic score (0-100) at or above which a comment is held for moderation. */
  spamHoldThreshold: number;
  /** Heuristic score (0-100) at or above which a comment is auto-marked spam. */
  spamRejectThreshold: number;
  /** A submission faster than this after the form rendered is a spam signal. */
  minRenderAgeSeconds: number;
  /** More links than this in a comment body is a spam signal. */
  linkThreshold: number;
  /** Hold a commenter's first-ever comment on this site for moderation. */
  firstCommentHold: boolean;
  /** Auto-approve a commenter who already has an approved comment on this site. */
  autoApprovePreviouslyApproved: boolean;
  /** Days a spam-marked comment is kept before the retention purge deletes it. */
  spamRetentionDays: number;
}

export const COMMENT_SETTINGS_KEY = "comments";

export const DEFAULT_COMMENT_SETTINGS: CommentSettings = {
  enabled: false,
  requireModeration: true,
  closeAfterDays: 0,
  allowUrls: true,
  notifyModerator: true,
  maxLength: 5000,
  threadMaxDepth: 6,
  pageSize: 50,
  captchaProvider: "none",
  captchaSiteKey: "",
  captchaScoreThreshold: 0.5,
  captchaSecretKey: "",
  spamHoldThreshold: 40,
  spamRejectThreshold: 75,
  minRenderAgeSeconds: 3,
  linkThreshold: 2,
  firstCommentHold: false,
  autoApprovePreviouslyApproved: false,
  spamRetentionDays: 30,
};

const CAPTCHA_PROVIDERS = new Set<CaptchaProvider>([
  "none",
  "turnstile",
  "hcaptcha",
  "recaptcha",
  "recaptcha-v3",
]);

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function asStr(value: unknown, fallback: string, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

export function normalizeCommentSettings(raw: unknown): CommentSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const provider = CAPTCHA_PROVIDERS.has(r.captchaProvider as CaptchaProvider)
    ? (r.captchaProvider as CaptchaProvider)
    : DEFAULT_COMMENT_SETTINGS.captchaProvider;
  // A hold threshold above the reject threshold would make every held comment
  // unreachable by the "hold" bucket; keep hold <= reject always.
  const spamRejectThreshold = asInt(
    r.spamRejectThreshold,
    DEFAULT_COMMENT_SETTINGS.spamRejectThreshold,
    0,
    100,
  );
  const spamHoldThreshold = Math.min(
    asInt(r.spamHoldThreshold, DEFAULT_COMMENT_SETTINGS.spamHoldThreshold, 0, 100),
    spamRejectThreshold,
  );
  return {
    enabled: asBool(r.enabled, DEFAULT_COMMENT_SETTINGS.enabled),
    requireModeration: asBool(r.requireModeration, DEFAULT_COMMENT_SETTINGS.requireModeration),
    closeAfterDays: asInt(r.closeAfterDays, DEFAULT_COMMENT_SETTINGS.closeAfterDays, 0, 3650),
    allowUrls: asBool(r.allowUrls, DEFAULT_COMMENT_SETTINGS.allowUrls),
    notifyModerator: asBool(r.notifyModerator, DEFAULT_COMMENT_SETTINGS.notifyModerator),
    maxLength: asInt(r.maxLength, DEFAULT_COMMENT_SETTINGS.maxLength, 200, 20_000),
    threadMaxDepth: asInt(r.threadMaxDepth, DEFAULT_COMMENT_SETTINGS.threadMaxDepth, 1, 10),
    pageSize: asInt(r.pageSize, DEFAULT_COMMENT_SETTINGS.pageSize, 5, 200),
    captchaProvider: provider,
    captchaSiteKey: asStr(r.captchaSiteKey, DEFAULT_COMMENT_SETTINGS.captchaSiteKey, 200),
    captchaScoreThreshold: asScoreThreshold(r.captchaScoreThreshold),
    captchaSecretKey: asStr(r.captchaSecretKey, DEFAULT_COMMENT_SETTINGS.captchaSecretKey, 200),
    spamHoldThreshold,
    spamRejectThreshold,
    minRenderAgeSeconds: asInt(
      r.minRenderAgeSeconds,
      DEFAULT_COMMENT_SETTINGS.minRenderAgeSeconds,
      0,
      60,
    ),
    linkThreshold: asInt(r.linkThreshold, DEFAULT_COMMENT_SETTINGS.linkThreshold, 1, 20),
    firstCommentHold: asBool(r.firstCommentHold, DEFAULT_COMMENT_SETTINGS.firstCommentHold),
    autoApprovePreviouslyApproved: asBool(
      r.autoApprovePreviouslyApproved,
      DEFAULT_COMMENT_SETTINGS.autoApprovePreviouslyApproved,
    ),
    spamRetentionDays: asInt(
      r.spamRetentionDays,
      DEFAULT_COMMENT_SETTINGS.spamRetentionDays,
      1,
      3650,
    ),
  };
}

function asScoreThreshold(value: unknown): number {
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(score)) return DEFAULT_COMMENT_SETTINGS.captchaScoreThreshold;
  return Math.min(Math.max(score, 0), 1);
}

export async function getCommentSettings(siteId?: string | null): Promise<CommentSettings> {
  const id = siteId ?? (await getSiteId());
  if (!id) return { ...DEFAULT_COMMENT_SETTINGS };
  const stored = await getSiteSetting<Record<string, unknown>>(id, COMMENT_SETTINGS_KEY);
  const settings = normalizeCommentSettings(stored ?? {});
  // The secret is stored encrypted (see saveCommentSettings); decryptSecret
  // passes a plaintext value through unchanged for rows written before this.
  settings.captchaSecretKey = decryptSecret(settings.captchaSecretKey);
  return settings;
}

export async function saveCommentSettings(
  siteId: string,
  patch: Partial<CommentSettings>,
): Promise<CommentSettings> {
  const current = await getCommentSettings(siteId);
  const next = normalizeCommentSettings({ ...current, ...patch });
  await setSiteSetting(siteId, COMMENT_SETTINGS_KEY, {
    ...next,
    captchaSecretKey: next.captchaSecretKey ? encryptSecret(next.captchaSecretKey) : "",
  });
  return next;
}

/** Redacted view for API responses — the secret key never leaves the server. */
export function toPublicCommentSettings(
  s: CommentSettings,
): Omit<CommentSettings, "captchaSecretKey"> & { captchaSecretKeySet: boolean } {
  const { captchaSecretKey, ...rest } = s;
  return { ...rest, captchaSecretKeySet: captchaSecretKey.length > 0 };
}

// ─── Per-content override (content.fields.comments) ──────────────────────────

export type CommentsOverride = "inherit" | "open" | "closed";

export function readCommentsOverride(fields: unknown): CommentsOverride {
  const value = (fields as Record<string, unknown> | null | undefined)?.comments;
  return value === "open" || value === "closed" ? value : "inherit";
}

export interface CommentsState {
  /**
   * Render the comments section at all. True whenever the block is placed — the
   * author put it there deliberately — so the reader always sees the thread and
   * a clear "comments are closed" notice rather than nothing.
   */
  visible: boolean;
  /** Show the submission form (existing thread may still render when false). */
  accepting: boolean;
}

/**
 * Resolve whether a placed Comments block still takes new submissions.
 *
 * The section is always visible where the block is placed. Whether the form
 * shows: a per-content `closed` override always closes it; a per-content `open`
 * override always opens it (even past `closeAfterDays`); otherwise the site
 * switch decides, and `closeAfterDays` (measured from `publishedAt`) closes it
 * once the post is old enough.
 */
export function commentsStateFor(
  content: { fields?: unknown; publishedAt?: Date | string | null },
  settings: CommentSettings,
  now: Date = new Date(),
): CommentsState {
  const override = readCommentsOverride(content.fields);
  if (override === "closed") return { visible: true, accepting: false };
  if (override === "open") return { visible: true, accepting: true };

  let accepting = settings.enabled;
  if (accepting && settings.closeAfterDays > 0 && content.publishedAt) {
    const published = new Date(content.publishedAt).getTime();
    if (Number.isFinite(published)) {
      const ageDays = (now.getTime() - published) / 86_400_000;
      if (ageDays > settings.closeAfterDays) accepting = false;
    }
  }
  return { visible: true, accepting };
}
