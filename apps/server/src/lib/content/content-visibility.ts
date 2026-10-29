// SPDX-License-Identifier: MIT

import type { AccessScope, UserCapability } from "@justflows/sdk";

/** How far a capability reaches when a list has no single owner to check. */
export type EditorialReach = "all" | "own" | "none";

export interface VisibilityAccess {
  capabilities: readonly string[];
  policy: { scopes?: Partial<Record<string, AccessScope>> };
}

export interface VisibilityRequest {
  siteId: string;
  contentType?: string;
  locale?: string;
}

/**
 * A row visitors may receive: published, not trashed, and not held for a future
 * publish time. Draft, archived, and scheduled rows are editorial.
 */
export function isPubliclyPublished(
  row: { status?: unknown; trashed_at?: unknown; published_at?: unknown },
  now = Date.now(),
): boolean {
  if (row.trashed_at != null && String(row.trashed_at) !== "") return false;
  if (String(row.status ?? "") !== "published") return false;
  if (row.published_at == null || row.published_at === "") return true;
  const at = new Date(String(row.published_at)).getTime();
  return !Number.isFinite(at) || at <= now;
}

function scopeMatches(scope: AccessScope | undefined, request: VisibilityRequest): boolean {
  if (!scope) return true;
  if (scope.siteIds?.length && !scope.siteIds.includes(request.siteId)) return false;
  if (scope.contentTypes?.length && (!request.contentType || !scope.contentTypes.includes(request.contentType))) {
    return false;
  }
  if (scope.locales?.length && (!request.locale || !scope.locales.includes(request.locale))) return false;
  return true;
}

/**
 * List reach for one capability. `own` means the capability is held but limited
 * to the actor's content, so the query filters on author instead of denying
 * the whole list.
 */
export function capabilityReach(
  access: VisibilityAccess,
  capability: UserCapability,
  request: VisibilityRequest,
): EditorialReach {
  if (!access.capabilities.includes(capability)) return "none";
  const scope = access.policy.scopes?.[capability];
  if (!scopeMatches(scope, request)) return "none";
  return scope?.ownership === "self" ? "own" : "all";
}

/** The narrower of two reaches. */
export function narrowerReach(left: EditorialReach, right: EditorialReach): EditorialReach {
  if (left === "none" || right === "none") return "none";
  if (left === "own" || right === "own") return "own";
  return "all";
}

/**
 * Unpublished rows are visible to someone who can update them, or to their
 * author when that person can create content. Create is not an ownership
 * scope, so it never opens every draft on the site.
 */
export function draftReach(updateReach: EditorialReach, authorCanCreate: boolean): EditorialReach {
  if (updateReach === "all") return "all";
  if (updateReach === "own" || authorCanCreate) return "own";
  return "none";
}

/** True when this actor may create a row of the requested type and locale. */
export function canCreateHere(access: VisibilityAccess, request: VisibilityRequest): boolean {
  return capabilityReach(access, "content:create", request) !== "none";
}

/**
 * Extra SQL, including the leading AND, that keeps a content list inside the
 * caller's editorial reach. A request for a non-published status with no
 * editorial reach is rejected so the filter is not silently dropped.
 */
export function editorialListFilter(input: {
  reach: EditorialReach;
  status: string | undefined;
  actorId: string;
}): { sql: string; params: string[] } | { error: "forbidden" } {
  const { reach, status, actorId } = input;
  if (status && status !== "published" && reach === "none") return { error: "forbidden" };
  const live = "(c.published_at IS NULL OR c.published_at <= CURRENT_TIMESTAMP)";
  if (reach === "none") {
    return {
      sql: ` AND c.status = 'published' AND c.trashed_at IS NULL AND ${live}`,
      params: [],
    };
  }
  if (reach === "own") {
    if (!status) {
      return {
        sql: ` AND c.trashed_at IS NULL AND ((c.status = 'published' AND ${live}) OR c.author_id = ?)`,
        params: [actorId],
      };
    }
    if (status !== "published") return { sql: " AND c.author_id = ?", params: [actorId] };
    return { sql: ` AND (${live} OR c.author_id = ?)`, params: [actorId] };
  }
  return { sql: "", params: [] };
}
