// SPDX-License-Identifier: MIT

import type { SpamCheckBackend } from "@justflows/sdk";
import { getDb } from "../database/db.js";
import { ensurePluginRuntime, getRuntimeHooks } from "../plugins/plugin-runtime.js";
import type { CommentSettings } from "./comments-settings.js";
import { matchRules, matchTrainedTerms } from "./comments-rules.js";
import { extractLinkDomains, emailDomain, scoreComment, type FormTokenStatus } from "./comments-spam-score.js";

/**
 * Orchestrates every spam signal into one status decision. Runs after the
 * cheap, always-on checks in comments-public.ts (rate limit, same-origin,
 * honeypot, CAPTCHA) — this is what decides among approved / pending / spam
 * for whatever is left.
 */

export type CommentDecisionStatus = "approved" | "pending" | "spam";

export interface SpamDecisionInput {
  siteId: string;
  contentId: string;
  ip: string;
  userAgent: string;
  authorName: string;
  authorEmail: string;
  authorUrl: string;
  /** Sanitized comment HTML, for link-domain extraction. */
  bodyHtml: string;
  /** Plain-text rendering of the body, for keyword/phrase checks. */
  plainText: string;
  userId: string | null;
  isAuthenticated: boolean;
  formToken: FormTokenStatus;
  settings: CommentSettings;
}

export interface SpamDecision {
  status: CommentDecisionStatus;
  score: number;
  reasons: string[];
  heldReason: string | null;
}

async function hasPreviousApprovedComment(
  siteId: string,
  userId: string | null,
  authorEmail: string,
): Promise<boolean> {
  const db = await getDb();
  if (userId) {
    const rows = await db.query<{ id: string }>(
      "SELECT id FROM comments WHERE site_id = ? AND user_id = ? AND status = 'approved' LIMIT 1",
      [siteId, userId],
    );
    return Boolean(rows[0]);
  }
  const email = authorEmail.trim().toLowerCase();
  if (!email) return false;
  const rows = await db.query<{ id: string }>(
    "SELECT id FROM comments WHERE site_id = ? AND user_id IS NULL AND LOWER(author_email) = ? AND status = 'approved' LIMIT 1",
    [siteId, email],
  );
  return Boolean(rows[0]);
}

async function spamBackend(siteId: string): Promise<SpamCheckBackend | null> {
  const hooks = getRuntimeHooks();
  if (!hooks.has("comments.spamBackend")) return null;
  return hooks.applyFilter("comments.spamBackend", null, { siteId }, { siteId, source: "http" });
}

async function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Spam backend timed out")), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Consult a plugin-registered external spam service, if any. Never a hard dependency. */
async function checkExternalBackend(
  siteId: string,
  input: SpamDecisionInput,
): Promise<{ verdict: "allow" | "spam" | "review"; reason?: string } | null> {
  try {
    await ensurePluginRuntime();
    const backend = await spamBackend(siteId);
    if (!backend) return null;
    const result = await withDeadline(
      backend.check({
        siteId,
        contentId: input.contentId,
        ip: input.ip,
        userAgent: input.userAgent,
        authorName: input.authorName,
        authorEmail: input.authorEmail,
        authorUrl: input.authorUrl,
        body: input.plainText.slice(0, 5000),
        links: extractLinkDomains(input.bodyHtml),
        isAuthenticated: input.isAuthenticated,
      }),
    );
    return { verdict: result.verdict, reason: result.reason };
  } catch (err) {
    console.error("[justflows] comments.spamBackend check failed:", err);
    return null;
  }
}

export async function decide(input: SpamDecisionInput): Promise<SpamDecision> {
  const { settings } = input;
  const linkDomains = extractLinkDomains(input.bodyHtml);
  // Total link occurrences, not unique domains — a wall of links all pointing
  // to the same domain is still a wall of links.
  const linkCount = (input.bodyHtml.match(/https?:\/\/[^\s"'<>]+/gi) ?? []).length;
  const authorDomain = emailDomain(input.authorEmail);

  const ruleHit = await matchRules(input.siteId, {
    authorEmail: input.authorEmail,
    authorEmailDomain: authorDomain,
    linkDomains,
    ip: input.ip,
    plainText: input.plainText,
  });

  if (ruleHit?.list === "block") {
    return { status: "spam", score: 100, reasons: [`rule:${ruleHit.rule.field}`], heldReason: "blocklist" };
  }

  const allowed = ruleHit?.list === "allow";

  const external = allowed ? null : await checkExternalBackend(input.siteId, input);
  if (external?.verdict === "spam") {
    return {
      status: "spam",
      score: 100,
      reasons: [`external:${external.reason ?? "spam"}`],
      heldReason: "external_spam",
    };
  }

  let score = 0;
  let reasons: string[] = [];
  if (!allowed) {
    const trainedTermMatches = await matchTrainedTerms(input.siteId, linkDomains, input.plainText);
    const scored = scoreComment({
      linkCount,
      linkThreshold: settings.linkThreshold,
      plainText: input.plainText,
      authorEmailDomain: authorDomain,
      formToken: input.formToken,
      trainedTermMatches,
    });
    score = scored.score;
    reasons = scored.reasons;
    if (external?.verdict === "review") {
      score = Math.min(100, score + 20);
      reasons.push("external:review");
    }
  }

  let status: CommentDecisionStatus;
  let heldReason: string | null = null;
  if (allowed) {
    status = "approved";
  } else if (score >= settings.spamRejectThreshold) {
    status = "spam";
    heldReason = "score";
  } else if (score >= settings.spamHoldThreshold || settings.requireModeration) {
    status = "pending";
    heldReason = score >= settings.spamHoldThreshold ? "score" : "moderation";
  } else {
    status = "approved";
  }

  // Author-history overrides only ever move a non-spam decision, and only
  // apply when the block/allow lists didn't already decide the outcome. Skip
  // the lookup entirely when neither setting is on.
  if (status !== "spam" && (settings.firstCommentHold || settings.autoApprovePreviouslyApproved)) {
    const hadPriorApproved = await hasPreviousApprovedComment(
      input.siteId,
      input.userId,
      input.authorEmail,
    );
    if (!allowed && settings.firstCommentHold && !hadPriorApproved && status === "approved") {
      status = "pending";
      heldReason = "first_time";
    } else if (settings.autoApprovePreviouslyApproved && hadPriorApproved && status === "pending") {
      status = "approved";
      heldReason = null;
    }
  }

  return { status, score, reasons, heldReason };
}
