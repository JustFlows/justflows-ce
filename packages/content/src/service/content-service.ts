import { randomUUID } from "node:crypto";
import type { HooksRegistry } from "@justflows/core";
import { slugify, uniqueSlug } from "./slugify.js";
import type {
  ContentItem,
  ContentRevision,
  CreateContentInput,
  UpdateContentInput,
  ContentQuery,
  ContentPage,
  BlockDocument,
} from "./types.js";

const EMPTY_BLOCKS: BlockDocument = { version: 1, blocks: [] };

/**
 * In-memory content store for Phase 3.
 * Phase 5+ will replace this with the Drizzle-backed implementation.
 */
export class ContentService {
  private readonly items = new Map<string, ContentItem>();
  private readonly revisions = new Map<string, ContentRevision[]>();
  private readonly siteExistingSlugs = new Map<string, Map<string, Set<string>>>();

  constructor(private readonly hooks: HooksRegistry) {}

  async create(input: CreateContentInput): Promise<ContentItem> {
    await this.hooks.dispatchGate("content.beforeCreate", { input }, { siteId: input.siteId });

    const type = input.type ?? "post";
    const baseSlug = input.slug ? input.slug : slugify(input.title);
    const slug = uniqueSlug(baseSlug, this.slugsFor(input.siteId, type));
    this.slugsFor(input.siteId, type).add(slug);

    const now = new Date().toISOString();
    const item: ContentItem = {
      id: randomUUID(),
      siteId: input.siteId,
      type,
      status: "draft",
      slug,
      title: input.title,
      excerpt: input.excerpt ?? null,
      blocks: input.blocks ?? EMPTY_BLOCKS,
      fields: input.fields ?? {},
      authorId: input.authorId ?? null,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    this.items.set(item.id, item);
    await this.hooks.dispatchAction(
      "content.created",
      { contentId: item.id, siteId: item.siteId },
      { siteId: item.siteId },
    );
    return item;
  }

  async get(id: string): Promise<ContentItem | undefined> {
    return this.items.get(id);
  }

  async find(query: ContentQuery): Promise<ContentPage> {
    let results = Array.from(this.items.values()).filter(
      (i) =>
        i.siteId === query.siteId &&
        (query.type == null || i.type === query.type) &&
        (query.status == null || i.status === query.status) &&
        (query.slug == null || i.slug === query.slug) &&
        (query.authorId == null || i.authorId === query.authorId),
    );

    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const limit = query.limit ?? 20;
    let start = 0;
    if (query.cursor) {
      const idx = results.findIndex((i) => i.id === query.cursor);
      if (idx >= 0) start = idx + 1;
    }

    const page = results.slice(start, start + limit);
    const nextCursor = page.length === limit ? page[page.length - 1]?.id : undefined;

    return { items: page, nextCursor, total: results.length };
  }

  async update(id: string, patch: UpdateContentInput): Promise<ContentItem> {
    const item = this.items.get(id);
    if (!item) throw new NotFoundError(`Content "${id}" not found`);

    if (patch.expectedVersion != null && patch.expectedVersion !== item.version) {
      throw new ConflictError(
        `Version conflict: expected ${patch.expectedVersion}, got ${item.version}`,
      );
    }

    await this.hooks.dispatchGate(
      "content.beforeUpdate",
      { contentId: id, siteId: item.siteId },
      { siteId: item.siteId },
    );
    this.saveRevision(item);

    const updated: ContentItem = {
      ...item,
      title: patch.title ?? item.title,
      excerpt: patch.excerpt !== undefined ? patch.excerpt : item.excerpt,
      blocks: patch.blocks ?? item.blocks,
      fields: patch.fields != null ? { ...item.fields, ...patch.fields } : item.fields,
      status: patch.status ?? item.status,
      updatedAt: new Date().toISOString(),
      version: item.version + 1,
    };

    if (patch.slug && patch.slug !== item.slug) {
      const slugSet = this.slugsFor(item.siteId, item.type);
      slugSet.delete(item.slug);
      const newSlug = uniqueSlug(patch.slug, slugSet);
      slugSet.add(newSlug);
      updated.slug = newSlug;
    }

    this.items.set(id, updated);
    await this.hooks.dispatchAction(
      "content.updated",
      { contentId: id, siteId: item.siteId },
      { siteId: item.siteId },
    );
    return updated;
  }

  async publish(id: string): Promise<ContentItem> {
    const item = this.items.get(id);
    if (!item) throw new NotFoundError(`Content "${id}" not found`);

    await this.hooks.dispatchGate(
      "content.beforePublish",
      { contentId: id, siteId: item.siteId },
      { siteId: item.siteId },
    );

    const now = new Date().toISOString();
    const updated: ContentItem = {
      ...item,
      status: "published",
      publishedAt: item.publishedAt ?? now,
      updatedAt: now,
      version: item.version + 1,
    };

    this.items.set(id, updated);
    await this.hooks.dispatchAction(
      "content.published",
      { contentId: id, siteId: item.siteId },
      { siteId: item.siteId },
    );
    return updated;
  }

  async unpublish(id: string): Promise<ContentItem> {
    const item = this.items.get(id);
    if (!item) throw new NotFoundError(`Content "${id}" not found`);

    const updated: ContentItem = {
      ...item,
      status: "draft",
      updatedAt: new Date().toISOString(),
      version: item.version + 1,
    };

    this.items.set(id, updated);
    await this.hooks.dispatchAction(
      "content.unpublished",
      { contentId: id, siteId: item.siteId },
      { siteId: item.siteId },
    );
    return updated;
  }

  async delete(id: string): Promise<void> {
    const item = this.items.get(id);
    if (!item) throw new NotFoundError(`Content "${id}" not found`);

    await this.hooks.dispatchGate(
      "content.beforeDelete",
      { contentId: id, siteId: item.siteId },
      { siteId: item.siteId },
    );
    this.items.delete(id);
    this.slugsFor(item.siteId, item.type).delete(item.slug);
    await this.hooks.dispatchAction(
      "content.deleted",
      { contentId: id, siteId: item.siteId },
      { siteId: item.siteId },
    );
  }

  async getRevisions(contentId: string): Promise<ContentRevision[]> {
    return this.revisions.get(contentId) ?? [];
  }

  async restoreRevision(contentId: string, revisionId: string): Promise<ContentItem> {
    const revs = this.revisions.get(contentId) ?? [];
    const rev = revs.find((r) => r.id === revisionId);
    if (!rev) throw new NotFoundError(`Revision "${revisionId}" not found`);
    return this.update(contentId, {
      title: rev.title,
      blocks: rev.blocks,
      fields: rev.fields,
    });
  }

  private saveRevision(item: ContentItem): void {
    const rev: ContentRevision = {
      id: randomUUID(),
      contentId: item.id,
      siteId: item.siteId,
      title: item.title,
      blocks: item.blocks,
      fields: item.fields,
      version: item.version,
      createdAt: new Date().toISOString(),
    };
    const list = this.revisions.get(item.id) ?? [];
    list.unshift(rev);
    // keep last 50 revisions
    this.revisions.set(item.id, list.slice(0, 50));
  }

  private slugsFor(siteId: string, type: string): Set<string> {
    let byType = this.siteExistingSlugs.get(siteId);
    if (!byType) {
      byType = new Map();
      this.siteExistingSlugs.set(siteId, byType);
    }
    let set = byType.get(type);
    if (!set) {
      set = new Set();
      byType.set(type, set);
    }
    return set;
  }
}

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";
  constructor(message: string) { super(message); this.name = "NotFoundError"; }
}

export class ConflictError extends Error {
  readonly code = "CONFLICT";
  constructor(message: string) { super(message); this.name = "ConflictError"; }
}
