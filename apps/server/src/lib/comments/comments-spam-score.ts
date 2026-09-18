// SPDX-License-Identifier: MIT

/**
 * Local heuristic spam scoring for public comment submissions. Deliberately
 * simple and inspectable rather than a trained model: a handful of weighted
 * signals summed into a 0-100 score, which comments-spam-policy.ts compares
 * against the site's configured hold/reject thresholds. Reasons are returned
 * alongside the score so a moderator can see why a comment landed where it did.
 */

// Small, representative built-in list, not itself admin-editable. Site
// owners add their own soft signal terms via the comment_spam_terms table
// (comments-rules.ts: addSpamTerm/listSpamTerms), which flow in through
// trainedTermMatches below rather than being merged into these constants.
const SPAM_KEYWORDS = [
  "viagra",
  "cialis",
  "casino",
  "porn",
  "xxx",
  "forex",
  "crypto giveaway",
  "make money fast",
  "work from home",
  "weight loss",
  "replica watches",
  "cheap nike",
  "bitcoin investment",
  "loan approved",
  "click here now",
  "buy followers",
  "seo services",
  "backlinks",
  "escort",
  "nude",
];

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "fakeinbox.com",
  "sharklasers.com",
  "dispostable.com",
  "mailnesia.com",
  "mintemail.com",
  "spamgourmet.com",
]);

export type FormTokenStatus = "ok" | "missing" | "tooFast";

export interface TrainedTermMatch {
  kind: "domain" | "phrase";
  value: string;
  weight: number;
}

export interface SpamSignals {
  linkCount: number;
  linkThreshold: number;
  /** Plain text (no markup) of the comment body, lowercased comparisons happen internally. */
  plainText: string;
  authorEmailDomain: string | null;
  formToken: FormTokenStatus;
  /** Includes both auto-trained and admin-added terms (comments-rules.ts). */
  trainedTermMatches: TrainedTermMatch[];
}

export interface SpamScoreResult {
  score: number;
  reasons: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Ratio of the single most-repeated word to total words — a crude "wall of the same word" detector. */
function repetitionRatio(plainText: string): number {
  const words = plainText.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  if (words.length < 8) return 0;
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const max = Math.max(...counts.values());
  return max / words.length;
}

export function scoreComment(signals: SpamSignals): SpamScoreResult {
  let score = 0;
  const reasons: string[] = [];
  const text = signals.plainText.toLowerCase();

  const excessLinks = signals.linkCount - signals.linkThreshold;
  if (excessLinks > 0) {
    score += clamp(excessLinks * 15, 0, 45);
    reasons.push(`links:${signals.linkCount}`);
  }

  const keywordHits = SPAM_KEYWORDS.filter((word) => text.includes(word));
  if (keywordHits.length > 0) {
    score += clamp(keywordHits.length * 20, 0, 60);
    reasons.push(`keywords:${keywordHits.length}`);
  }

  if (signals.authorEmailDomain && DISPOSABLE_EMAIL_DOMAINS.has(signals.authorEmailDomain)) {
    score += 30;
    reasons.push("disposable_email");
  }

  if (repetitionRatio(signals.plainText) > 0.4) {
    score += 20;
    reasons.push("repetitive");
  }

  if (signals.formToken === "missing") {
    score += 15;
    reasons.push("form_token_missing");
  } else if (signals.formToken === "tooFast") {
    score += 25;
    reasons.push("form_too_fast");
  }

  if (signals.trainedTermMatches.length > 0) {
    // Deliberately uncapped, unlike the categories above: each match here is
    // either an admin-typed known-bad term or one the community already
    // confirmed as spam via "mark as spam" — several matching in one comment
    // is compounding evidence, not the same kind of fuzzy signal as a link
    // count or a keyword hit, and should be free to add up. The final score
    // clamp below still bounds the total to 100.
    const trainedWeight = signals.trainedTermMatches.reduce((sum, m) => sum + m.weight, 0);
    score += trainedWeight;
    reasons.push(`trained:${signals.trainedTermMatches.map((m) => m.value).join(",")}`);
  }

  return { score: clamp(Math.round(score), 0, 100), reasons };
}

/** Extract http(s) link hostnames from sanitized comment HTML/text. */
export function extractLinkDomains(html: string): string[] {
  const matches = html.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  const domains = new Set<string>();
  for (const raw of matches) {
    try {
      domains.add(new URL(raw).hostname.toLowerCase());
    } catch {
      // Malformed URL text ignore rather than let it throw the whole pipeline.
    }
  }
  return [...domains];
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at === -1
    ? null
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase() || null;
}
