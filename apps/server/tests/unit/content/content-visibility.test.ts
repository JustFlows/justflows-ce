// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  canCreateHere,
  capabilityReach,
  draftReach,
  editorialListFilter,
  isPubliclyPublished,
  narrowerReach,
} from "../../../src/lib/content/content-visibility.js";

const subscriber = { capabilities: ["content:read"], policy: { scopes: {} } };
const author = {
  capabilities: ["content:read", "content:create", "content:update", "content:revisions:read"],
  policy: {
    scopes: {
      "content:update": { ownership: "self" as const },
      "content:revisions:read": { ownership: "self" as const },
    },
  },
};
const contributor = {
  capabilities: ["content:read", "content:create", "content:revisions:read"],
  policy: { scopes: { "content:revisions:read": { ownership: "self" as const } } },
};

describe("isPubliclyPublished", () => {
  it("accepts a published row and rejects drafts, trash, and a future publish time", () => {
    expect(isPubliclyPublished({ status: "published", trashed_at: null, published_at: null })).toBe(true);
    expect(isPubliclyPublished({ status: "draft", trashed_at: null, published_at: null })).toBe(false);
    expect(isPubliclyPublished({ status: "archived", trashed_at: null })).toBe(false);
    expect(isPubliclyPublished({ status: "published", trashed_at: "2026-01-01" })).toBe(false);
    expect(
      isPubliclyPublished(
        { status: "published", published_at: "2099-01-01T00:00:00.000Z" },
        Date.parse("2026-01-01T00:00:00.000Z"),
      ),
    ).toBe(false);
  });
});

describe("draft reach", () => {
  const request = { siteId: "site-1" };

  it("keeps a subscriber on published rows", () => {
    const reach = draftReach(capabilityReach(subscriber, "content:update", request), canCreateHere(subscriber, request));
    expect(reach).toBe("none");
    expect(editorialListFilter({ reach, status: "draft", actorId: "user-1" })).toEqual({ error: "forbidden" });
    const listed = editorialListFilter({ reach, status: undefined, actorId: "user-1" });
    expect("sql" in listed ? listed.sql : "").toContain("c.status = 'published'");
  });

  it("lets an author see their own unpublished rows and every published row", () => {
    const reach = draftReach(capabilityReach(author, "content:update", request), canCreateHere(author, request));
    expect(reach).toBe("own");
    const listed = editorialListFilter({ reach, status: undefined, actorId: "user-1" });
    expect("sql" in listed && listed.sql).toContain("c.author_id = ?");
    expect("params" in listed && listed.params).toEqual(["user-1"]);
  });

  it("lets a contributor see drafts they created without opening every draft", () => {
    const reach = draftReach(
      capabilityReach(contributor, "content:update", request),
      canCreateHere(contributor, request),
    );
    expect(reach).toBe("own");
    expect(capabilityReach(contributor, "content:revisions:read", request)).toBe("own");
  });

  it("narrows a site-wide editor key to the key's own ownership", () => {
    expect(narrowerReach("all", "own")).toBe("own");
    expect(narrowerReach("all", "none")).toBe("none");
  });
});
