// SPDX-License-Identifier: MIT

import type { BlockDocument } from "./types.js";

export const DEFAULT_REVISION_MAX_HISTORY = 5;
export const DEFAULT_AUTOSAVE_RETENTION_DAYS = 7;
export const REVISION_PRUNE_BATCH = 100;

export type RevisionKind = "working" | "autosave" | "historical";
export type RevisionSource = "manual" | "autosave" | "import" | "api";

export interface ContentSnapshot {
  title: string;
  slug: string;
  excerpt: string | null;
  blocks: BlockDocument;
  fields: Record<string, unknown>;
}

export interface RevisionDiffEntry {
  field: "title" | "slug" | "excerpt" | "blocks" | "fields";
  live: unknown;
  working: unknown;
}

export interface RevisionDiff {
  changed: boolean;
  entries: RevisionDiffEntry[];
}

export function overlaySnapshot<T extends ContentSnapshot>(live: T, working: ContentSnapshot): T {
  return {
    ...live,
    title: working.title,
    slug: working.slug,
    excerpt: working.excerpt,
    blocks: working.blocks,
    fields: working.fields,
  };
}

function stable(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function diffSnapshots(live: ContentSnapshot, working: ContentSnapshot): RevisionDiff {
  const entries: RevisionDiffEntry[] = [];
  const fields: Array<RevisionDiffEntry["field"]> = ["title", "slug", "excerpt", "blocks", "fields"];
  for (const field of fields) {
    if (stable(live[field]) !== stable(working[field])) {
      entries.push({ field, live: live[field], working: working[field] });
    }
  }
  return { changed: entries.length > 0, entries };
}

export function snapshotsEqual(a: ContentSnapshot, b: ContentSnapshot): boolean {
  return !diffSnapshots(a, b).changed;
}

/**
 * IDs of historical revisions that may be deleted. Never includes the live
 * snapshot (not in this list) or any working/autosave revision.
 */
export function selectHistoricalIdsToPrune(
  historical: Array<{ id: string; createdAt: string }>,
  maxHistory = DEFAULT_REVISION_MAX_HISTORY,
): string[] {
  if (maxHistory < 0) return [];
  const ordered = [...historical].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return ordered.slice(maxHistory).map((row) => row.id);
}

/** Newest historical revisions an editor can list and restore. */
export function visibleHistoricalRevisions<T extends { kind?: string; createdAt: string }>(
  revisions: T[],
  maxHistory = DEFAULT_REVISION_MAX_HISTORY,
): T[] {
  if (maxHistory <= 0) return [];
  return [...revisions]
    .filter((row) => (row.kind ?? "historical") === "historical")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, maxHistory);
}

export function selectAutosaveIdsToPrune(
  autosaves: Array<{ id: string; createdAt: string }>,
  retentionDays = DEFAULT_AUTOSAVE_RETENTION_DAYS,
  now = new Date(),
): string[] {
  if (retentionDays < 0) return [];
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return autosaves
    .filter((row) => new Date(row.createdAt).getTime() < cutoff)
    .map((row) => row.id);
}
