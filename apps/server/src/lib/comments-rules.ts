// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { auditLog } from "./audit-log.js";
import { extractLinkDomains, type TrainedTermMatch } from "./comments-spam-score.js";

/**
 * Admin-curated block/allow rules (hard verdicts) and the soft, weighted
 * spam-signal terms that feed the heuristic scorer. Kept in one file since
 * both are moderation-list concerns, but they are two distinct tables:
 * comment_moderation_rules is explicit and admin-owned; comment_spam_terms
 * holds both terms the "mark as spam" feedback loop trained automatically
 * (source='trained') and ones an admin typed in directly (source='manual') —
 * training never resizes or overwrites a manual entry.
 */

export const RULE_LIST_VALUES = ["block", "allow"] as const;
export type RuleList = (typeof RULE_LIST_VALUES)[number];

export const RULE_FIELD_VALUES = ["author_email", "author_domain", "ip", "phrase"] as const;
export type RuleField = (typeof RULE_FIELD_VALUES)[number];

const RULE_FIELDS = new Set<RuleField>(RULE_FIELD_VALUES);

export interface ModerationRule {
  id: string;
  list: RuleList;
  field: RuleField;
  pattern: string;
  note: string | null;
  createdBy: string | null;
  createdAt: unknown;
  hitCount: number;
  lastHitAt: unknown;
}

export interface RuleActor {
  siteId: string;
  userId: string;
  role?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

function now(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function toRule(row: Record<string, unknown>): ModerationRule {
  return {
    id: String(row.id),
    list: row.list === "allow" ? "allow" : "block",
    field: RULE_FIELDS.has(row.field as RuleField) ? (row.field as RuleField) : "phrase",
    pattern: String(row.pattern ?? ""),
    note: row.note == null ? null : String(row.note),
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: row.created_at,
    hitCount: Number(row.hit_count ?? 0),
    lastHitAt: row.last_hit_at ?? null,
  };
}

export async function listRules(siteId: string): Promise<ModerationRule[]> {
  const db = await getDb();
  const rows = await db.query<Record<string, unknown>>(
    "SELECT * FROM comment_moderation_rules WHERE site_id = ? ORDER BY created_at DESC",
    [siteId],
  );
  return rows.map(toRule);
}

export async function addRule(
  actor: RuleActor,
  input: { list: RuleList; field: RuleField; pattern: string; note?: string | null },
): Promise<ModerationRule> {
  const pattern = input.pattern.trim().slice(0, 500);
  if (!pattern) throw new Error("Pattern is required");
  const normalizedPattern = input.field === "ip" ? pattern : pattern.toLowerCase();
  const db = await getDb();
  const id = randomUUID();
  await db.run(
    `INSERT INTO comment_moderation_rules
       (id, site_id, list, field, pattern, note, created_by, created_at, hit_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
      actor.siteId,
      input.list,
      input.field,
      normalizedPattern,
      input.note?.trim().slice(0, 500) || null,
      actor.userId,
      now(),
    ],
  );
  void auditLog({
    siteId: actor.siteId,
    action: "comment.rule_added",
    actorId: actor.userId,
    actorRole: actor.role ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    target: id,
    detail: `${input.list}:${input.field}`,
  });
  const rows = await db.query<Record<string, unknown>>(
    "SELECT * FROM comment_moderation_rules WHERE id = ? AND site_id = ? LIMIT 1",
    [id, actor.siteId],
  );
  return toRule(rows[0]!);
}

export async function removeRule(actor: RuleActor, id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    "SELECT id FROM comment_moderation_rules WHERE id = ? AND site_id = ? LIMIT 1",
    [id, actor.siteId],
  );
  if (!rows[0]) return false;
  await db.run("DELETE FROM comment_moderation_rules WHERE id = ? AND site_id = ?", [
    id,
    actor.siteId,
  ]);
  void auditLog({
    siteId: actor.siteId,
    action: "comment.rule_removed",
    actorId: actor.userId,
    actorRole: actor.role ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    target: id,
  });
  return true;
}

export interface RuleMatchInput {
  authorEmail: string;
  authorEmailDomain: string | null;
  linkDomains: string[];
  ip: string;
  plainText: string;
}

/** IP field matches exactly, or as a dotted prefix when the pattern ends with a dot. */
function ipMatches(pattern: string, ip: string): boolean {
  if (pattern.endsWith(".")) return ip.startsWith(pattern);
  return pattern === ip;
}

function domainMatches(pattern: string, domain: string): boolean {
  return domain === pattern || domain.endsWith(`.${pattern}`);
}

function ruleMatchesInput(rule: ModerationRule, input: RuleMatchInput): boolean {
  switch (rule.field) {
    case "author_email":
      return Boolean(input.authorEmail) && input.authorEmail.toLowerCase() === rule.pattern;
    case "author_domain":
      // An allow rule only vouches for the commenter's own email domain — matching
      // it against link domains in the body would let anyone bypass moderation by
      // linking to an allow-listed site. A block rule may still catch either, since
      // a link to a known-bad domain is itself a spam signal.
      if (rule.list === "allow") {
        return Boolean(input.authorEmailDomain) && domainMatches(rule.pattern, input.authorEmailDomain!);
      }
      return (
        (Boolean(input.authorEmailDomain) && domainMatches(rule.pattern, input.authorEmailDomain!)) ||
        input.linkDomains.some((d) => domainMatches(rule.pattern, d))
      );
    case "ip":
      return Boolean(input.ip) && ipMatches(rule.pattern, input.ip);
    case "phrase":
      return input.plainText.toLowerCase().includes(rule.pattern);
    default:
      return false;
  }
}

/** Allow wins over block when both would match — an explicit allow is the stronger admin signal. */
export async function matchRules(
  siteId: string,
  input: RuleMatchInput,
): Promise<{ list: RuleList; rule: ModerationRule } | null> {
  const rules = await listRules(siteId);
  const allowHit = rules.find((r) => r.list === "allow" && ruleMatchesInput(r, input));
  const hit = allowHit ?? rules.find((r) => r.list === "block" && ruleMatchesInput(r, input));
  if (!hit) return null;
  const db = await getDb();
  void db
    .run("UPDATE comment_moderation_rules SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?", [
      now(),
      hit.id,
    ])
    .catch(() => undefined);
  return { list: hit.list, rule: hit };
}

// ─── Trained terms (soft signals from "mark as spam") ─────────────────────

const STOPWORDS = new Set([
  "this",
  "that",
  "with",
  "have",
  "your",
  "from",
  "they",
  "will",
  "would",
  "there",
  "their",
  "what",
  "about",
  "which",
  "when",
  "make",
  "like",
  "just",
  "into",
  "some",
  "than",
  "then",
  "them",
  "were",
]);

function significantWords(plainText: string, max = 5): string[] {
  const counts = new Map<string, number>();
  for (const word of plainText.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
    if (STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([word]) => word);
}

async function upsertTerm(siteId: string, kind: "domain" | "phrase", value: string, delta: number): Promise<void> {
  const db = await getDb();
  const existing = await db.query<{ id: string; weight: number; hits: number; source: string }>(
    "SELECT id, weight, hits, source FROM comment_spam_terms WHERE site_id = ? AND kind = ? AND value = ? LIMIT 1",
    [siteId, kind, value],
  );
  const row = existing[0];
  // An admin-added term already covers this value; training must never
  // resize or shadow it with an automatic row of the same (site, kind, value).
  if (row?.source === "manual") return;
  if (row) {
    const weight = Math.max(0, Number(row.weight) + delta);
    const hits = delta > 0 ? Number(row.hits) + 1 : Number(row.hits);
    await db.run("UPDATE comment_spam_terms SET weight = ?, hits = ?, updated_at = ? WHERE id = ?", [
      weight,
      hits,
      now(),
      row.id,
    ]);
  } else if (delta > 0) {
    await db.run(
      `INSERT INTO comment_spam_terms (id, site_id, kind, value, weight, hits, source, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 'trained', ?)`,
      [randomUUID(), siteId, kind, value, delta, now()],
    );
  }
}

/** Called when a comment's status changes to/from "spam" — feeds the local heuristic. */
export async function trainFromMark(
  siteId: string,
  commentId: string,
  direction: "spam" | "unspam",
): Promise<void> {
  const db = await getDb();
  const rows = await db.query<{ body: string }>(
    "SELECT body FROM comments WHERE id = ? AND site_id = ? LIMIT 1",
    [commentId, siteId],
  );
  const body = rows[0]?.body;
  if (!body) return;
  const { commentPlainText } = await import("./comments-public.js");
  const plainText = commentPlainText(body);
  const delta = direction === "spam" ? 1 : -1;
  const domains = extractLinkDomains(body);
  const words = significantWords(plainText);
  await Promise.all([
    ...domains.map((d) => upsertTerm(siteId, "domain", d, delta)),
    ...words.map((w) => upsertTerm(siteId, "phrase", w, delta)),
  ]);
}

/** Trained terms (weight > 0) that appear in this submission, for the heuristic scorer. */
export async function matchTrainedTerms(
  siteId: string,
  domains: string[],
  plainText: string,
): Promise<TrainedTermMatch[]> {
  const db = await getDb();
  const rows = await db.query<{ kind: "domain" | "phrase"; value: string; weight: number }>(
    "SELECT kind, value, weight FROM comment_spam_terms WHERE site_id = ? AND weight > 0",
    [siteId],
  );
  const lowerText = plainText.toLowerCase();
  const domainSet = new Set(domains);
  return rows
    .filter((row) =>
      row.kind === "domain" ? domainSet.has(row.value) : lowerText.includes(row.value),
    )
    .map((row) => ({ kind: row.kind, value: row.value, weight: Number(row.weight) }));
}

// ─── Admin-curated spam-signal terms (kept in the same table, source='manual') ──

/** A fixed, sensible signal — roughly one keyword hit's worth — without a UI for tuning it. */
const MANUAL_TERM_WEIGHT = 20;

export interface SpamTerm {
  id: string;
  kind: "domain" | "phrase";
  value: string;
  weight: number;
  hits: number;
  source: "trained" | "manual";
  updatedAt: unknown;
}

function toSpamTerm(row: Record<string, unknown>): SpamTerm {
  return {
    id: String(row.id),
    kind: row.kind === "domain" ? "domain" : "phrase",
    value: String(row.value ?? ""),
    weight: Number(row.weight ?? 0),
    hits: Number(row.hits ?? 0),
    source: row.source === "manual" ? "manual" : "trained",
    updatedAt: row.updated_at,
  };
}

export async function listSpamTerms(siteId: string): Promise<SpamTerm[]> {
  const db = await getDb();
  const rows = await db.query<Record<string, unknown>>(
    "SELECT * FROM comment_spam_terms WHERE site_id = ? ORDER BY updated_at DESC",
    [siteId],
  );
  return rows.map(toSpamTerm);
}

export async function addSpamTerm(
  actor: RuleActor,
  input: { kind: "domain" | "phrase"; value: string },
): Promise<SpamTerm> {
  const value = input.value.trim().toLowerCase().slice(0, 255);
  if (!value) throw new Error("Value is required");
  const db = await getDb();
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM comment_spam_terms WHERE site_id = ? AND kind = ? AND value = ? LIMIT 1",
    [actor.siteId, input.kind, value],
  );
  const id = existing[0]?.id ?? randomUUID();
  if (existing[0]) {
    // Re-adding a term a moderator once deleted or that training already found:
    // promote it to admin-owned, at the fixed manual weight, hits untouched.
    await db.run(
      "UPDATE comment_spam_terms SET source = 'manual', weight = ?, updated_at = ? WHERE id = ?",
      [MANUAL_TERM_WEIGHT, now(), id],
    );
  } else {
    await db.run(
      `INSERT INTO comment_spam_terms (id, site_id, kind, value, weight, hits, source, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 'manual', ?)`,
      [id, actor.siteId, input.kind, value, MANUAL_TERM_WEIGHT, now()],
    );
  }
  void auditLog({
    siteId: actor.siteId,
    action: "comment.spam_term_added",
    actorId: actor.userId,
    actorRole: actor.role ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    target: id,
    detail: `${input.kind}:${value}`,
  });
  const rows = await db.query<Record<string, unknown>>(
    "SELECT * FROM comment_spam_terms WHERE id = ? AND site_id = ? LIMIT 1",
    [id, actor.siteId],
  );
  return toSpamTerm(rows[0]!);
}

/** Removes any term regardless of source — a moderator may also clear a learned false positive. */
export async function removeSpamTerm(actor: RuleActor, id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    "SELECT id FROM comment_spam_terms WHERE id = ? AND site_id = ? LIMIT 1",
    [id, actor.siteId],
  );
  if (!rows[0]) return false;
  await db.run("DELETE FROM comment_spam_terms WHERE id = ? AND site_id = ?", [id, actor.siteId]);
  void auditLog({
    siteId: actor.siteId,
    action: "comment.spam_term_removed",
    actorId: actor.userId,
    actorRole: actor.role ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    target: id,
  });
  return true;
}
