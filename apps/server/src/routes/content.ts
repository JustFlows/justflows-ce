import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { serializeContentRow } from "../lib/content-api.js";
import { resolveContentLocale } from "../lib/i18n/languages-db.js";
import { invalidateContentCache } from "../lib/content-public.js";
import { getRuntimeHooks } from "../lib/plugin-runtime.js";
import { isHookAbortError } from "@justflows/core";
import { sanitizeBlockDocument } from "@justflows/blocks";
import { requireRole } from "../middleware/auth.js";
import {
  canDeleteAnyContent,
  canPublish,
  CONTENT_READ_ROLES,
  CONTENT_WRITE_ROLES,
} from "../lib/rbac.js";
import { param } from "../lib/params.js";
import { ContentTypeSlugSchema } from "@justflows/content";
import { getContentTypeBySlug } from "../lib/content-types-db.js";

const router = Router();

const CreateSchema = z.object({
  type: ContentTypeSlugSchema.default("post"),
  title: z.string().min(1),
  slug: z.string().optional(),
  excerpt: z.string().optional(),
  locale: z.string().optional(),
  translationGroupId: z.string().uuid().optional(),
  blocks: z.object({ version: z.literal(1), blocks: z.array(z.unknown()) }).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
});

const PatchSchema = z
  .object({
    title: z.string().min(1).optional(),
    slug: z.string().optional(),
    excerpt: z.string().nullable().optional(),
    blocks: z.unknown().optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    status: z.enum(["draft", "published", "archived", "scheduled"]).optional(),
  })
  .passthrough();

const TranslateSchema = z.object({
  locale: z.string().min(2).max(20),
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 200);
}

function now(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

router.get("/", requireRole(...CONTENT_READ_ROLES), async (req, res) => {
  const session = req.session!;
  const type = req.query.type as string | undefined;
  const status = req.query.status as string | undefined;
  const slug = req.query.slug as string | undefined;
  const locale = req.query.locale as string | undefined;
  const translationGroupId = req.query.translationGroupId as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? "20"), 100);
  const cursor = req.query.cursor as string | undefined;

  try {
    const db = await getDb();
    let sql =
      "SELECT id, type, title, slug, locale, translation_group_id, excerpt, status, author_id, published_at, created_at, updated_at FROM content WHERE site_id = ?";
    const params: (string | number | boolean | null)[] = [session.siteId];

    if (type) {
      sql += " AND type = ?";
      params.push(type);
    }
    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    if (slug) {
      sql += " AND slug = ?";
      params.push(slug);
    }
    if (locale) {
      sql += " AND locale = ?";
      params.push(await resolveContentLocale(locale, session.siteId));
    }
    if (translationGroupId) {
      sql += " AND translation_group_id = ?";
      params.push(translationGroupId);
    }
    if (cursor) {
      sql += " AND id > ?";
      params.push(cursor);
    }

    sql += " ORDER BY updated_at DESC LIMIT ?";
    params.push(limit + 1);

    const rows = await db.query<Record<string, unknown>>(sql, params);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    res.json({
      items: items.map(serializeContentRow),
      nextCursor: hasMore ? items[items.length - 1]?.id : null,
      total: items.length,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/", requireRole(...CONTENT_WRITE_ROLES), async (req, res) => {
  const session = req.session!;

  try {
    const body = CreateSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0]?.message });
      return;
    }

    const { type, title, excerpt, blocks, fields } = body.data;
    const registered = await getContentTypeBySlug(type, session.siteId);
    if (!registered) {
      res.status(400).json({ error: `Unknown content type "${type}"` });
      return;
    }
    const slug = body.data.slug ? slugify(body.data.slug) : slugify(title);
    const id = randomUUID();
    const locale = await resolveContentLocale(body.data.locale, session.siteId);
    const translationGroupId = body.data.translationGroupId ?? id;
    const hooks = getRuntimeHooks();
    const hookCtx = {
      siteId: session.siteId,
      source: "http" as const,
      actor: { userId: session.userId, role: session.role },
    };

    try {
      await hooks.dispatchGate(
        "content.beforeCreate",
        {
          input: {
            siteId: session.siteId,
            type,
            title,
            slug,
            excerpt: excerpt ?? null,
            fields: fields ?? {},
          },
        },
        hookCtx,
      );
    } catch (err) {
      if (isHookAbortError(err)) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }

    const db = await getDb();

    await db.run(
      `INSERT INTO content (id, site_id, type, title, slug, locale, translation_group_id, excerpt, blocks, fields, status, author_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [
        id,
        session.siteId,
        type,
        title,
        slug,
        locale,
        translationGroupId,
        excerpt ?? null,
        JSON.stringify(sanitizeBlockDocument(blocks)),
        JSON.stringify(fields ?? {}),
        session.userId,
        now(),
        now(),
      ],
    );

    const rows = await db.query<Record<string, unknown>>("SELECT * FROM content WHERE id = ?", [id]);
    await hooks.dispatchAction(
      "content.created",
      { contentId: id, siteId: session.siteId },
      hookCtx,
    );
    res.status(201).json(serializeContentRow(rows[0]!));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/:id/translate", requireRole(...CONTENT_WRITE_ROLES), async (req, res) => {
  const session = req.session!;
  const id = param(req.params.id);
  const body = TranslateSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message });
    return;
  }

  try {
    const db = await getDb();
    const rows = await db.query<Record<string, unknown>>(
      "SELECT * FROM content WHERE id = ? AND site_id = ? LIMIT 1",
      [id, session.siteId],
    );
    const source = rows[0];
    if (!source) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const locale = await resolveContentLocale(body.data.locale, session.siteId);
    const groupId = source.translation_group_id ? String(source.translation_group_id) : String(source.id);

    if (!source.translation_group_id) {
      await db.run(
        "UPDATE content SET translation_group_id = ?, updated_at = ? WHERE id = ? AND site_id = ?",
        [groupId, now(), id, session.siteId],
      );
    }

    const existing = await db.query<{ id: string }>(
      "SELECT id FROM content WHERE site_id = ? AND translation_group_id = ? AND locale = ? LIMIT 1",
      [session.siteId, groupId, locale],
    );
    if (existing[0]) {
      res.status(409).json({
        error: "A translation for this language already exists",
        contentId: existing[0].id,
      });
      return;
    }

    const newId = randomUUID();
    const hooks = getRuntimeHooks();
    const hookCtx = {
      siteId: session.siteId,
      source: "http" as const,
      actor: { userId: session.userId, role: session.role },
    };

    try {
      await hooks.dispatchGate(
        "content.beforeCreate",
        {
          input: {
            siteId: session.siteId,
            type: String(source.type),
            title: String(source.title),
            slug: String(source.slug),
            excerpt: source.excerpt == null ? null : String(source.excerpt),
            fields: {},
          },
        },
        hookCtx,
      );
    } catch (err) {
      if (isHookAbortError(err)) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }

    let parsedBlocks: unknown = source.blocks;
    if (typeof source.blocks === "string") {
      try {
        parsedBlocks = JSON.parse(source.blocks);
      } catch {
        parsedBlocks = { version: 1, blocks: [] };
      }
    }
    const blocksValue = JSON.stringify(sanitizeBlockDocument(parsedBlocks));
    const fieldsValue =
      typeof source.fields === "string"
        ? source.fields
        : JSON.stringify(source.fields ?? {});

    await db.run(
      `INSERT INTO content (id, site_id, type, title, slug, locale, translation_group_id, excerpt, blocks, fields, status, author_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [
        newId,
        session.siteId,
        String(source.type),
        String(source.title),
        String(source.slug),
        locale,
        groupId,
        source.excerpt == null ? null : String(source.excerpt),
        blocksValue,
        fieldsValue,
        session.userId,
        now(),
        now(),
      ],
    );

    const created = await db.query<Record<string, unknown>>(
      "SELECT * FROM content WHERE id = ? AND site_id = ? LIMIT 1",
      [newId, session.siteId],
    );
    await hooks.dispatchAction(
      "content.created",
      { contentId: newId, siteId: session.siteId },
      hookCtx,
    );
    res.status(201).json(serializeContentRow(created[0]!));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/:id", requireRole(...CONTENT_READ_ROLES), async (req, res) => {
  const session = req.session!;
  const id = param(req.params.id);
  const db = await getDb();
  const rows = await db.query<Record<string, unknown>>(
    "SELECT * FROM content WHERE id = ? AND site_id = ? LIMIT 1",
    [id, session.siteId],
  );
  if (!rows[0]) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serializeContentRow(rows[0]));
});

router.patch("/:id", requireRole(...CONTENT_WRITE_ROLES), async (req, res) => {
  const session = req.session!;
  const id = param(req.params.id);
  const body = PatchSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message });
    return;
  }

  try {
    const db = await getDb();

    const existing = await db.query<{ author_id: string | null; status: string }>(
      "SELECT author_id, status FROM content WHERE id = ? AND site_id = ? LIMIT 1",
      [id, session.siteId],
    );
    const row = existing[0];
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const isOwner = row.author_id === session.userId;
    if (!canDeleteAnyContent(session.role) && !isOwner) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (
      body.data.status === "published" &&
      !canPublish(session.role)
    ) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const hooks = getRuntimeHooks();
    const hookCtx = {
      siteId: session.siteId,
      source: "http" as const,
      actor: { userId: session.userId, role: session.role },
    };
    const contentRef = { contentId: id, siteId: session.siteId };

    try {
      await hooks.dispatchGate("content.beforeUpdate", contentRef, hookCtx);
      if (body.data.status === "published" && row.status !== "published") {
        await hooks.dispatchGate("content.beforePublish", contentRef, hookCtx);
      }
    } catch (err) {
      if (isHookAbortError(err)) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }

    const fields: string[] = [];
    const values: (string | number | boolean | null)[] = [];

    if (body.data.title !== undefined) {
      fields.push("title = ?");
      values.push(body.data.title);
    }
    if (body.data.slug !== undefined) {
      fields.push("slug = ?");
      values.push(body.data.slug);
    }
    if (body.data.excerpt !== undefined) {
      fields.push("excerpt = ?");
      values.push(body.data.excerpt);
    }
    if (body.data.blocks !== undefined) {
      fields.push("blocks = ?");
      values.push(JSON.stringify(sanitizeBlockDocument(body.data.blocks)));
    }
    if (body.data.fields !== undefined) {
      fields.push("fields = ?");
      values.push(JSON.stringify(body.data.fields));
    }
    if (body.data.status !== undefined) {
      fields.push("status = ?");
      values.push(body.data.status);
      if (body.data.status === "published") {
        fields.push("published_at = COALESCE(published_at, ?)");
        values.push(now());
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    fields.push("updated_at = ?");
    values.push(now());
    values.push(id, session.siteId);

    await db.run(`UPDATE content SET ${fields.join(", ")} WHERE id = ? AND site_id = ?`, values);

    const rows = await db.query<Record<string, unknown>>(
      "SELECT * FROM content WHERE id = ? AND site_id = ? LIMIT 1",
      [id, session.siteId],
    );
    await invalidateContentCache();
    await hooks.dispatchAction("content.updated", contentRef, hookCtx);

    const nextStatus = body.data.status ?? row.status;
    if (body.data.status === "published" && row.status !== "published") {
      await hooks.dispatchAction("content.published", contentRef, hookCtx);
    } else if (
      row.status === "published" &&
      body.data.status !== undefined &&
      nextStatus !== "published"
    ) {
      await hooks.dispatchAction("content.unpublished", contentRef, hookCtx);
    }

    res.json(rows[0] ? serializeContentRow(rows[0]) : { error: "Not found" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete("/:id", requireRole(...CONTENT_WRITE_ROLES), async (req, res) => {
  const session = req.session!;
  const id = param(req.params.id);
  const db = await getDb();

  const existing = await db.query<{ author_id: string | null }>(
    "SELECT author_id FROM content WHERE id = ? AND site_id = ? LIMIT 1",
    [id, session.siteId],
  );
  const row = existing[0];
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const isOwner = row.author_id === session.userId;
  if (!canDeleteAnyContent(session.role) && !isOwner) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const hooks = getRuntimeHooks();
  const hookCtx = {
    siteId: session.siteId,
    source: "http" as const,
    actor: { userId: session.userId, role: session.role },
  };
  const contentRef = { contentId: id, siteId: session.siteId };

  try {
    await hooks.dispatchGate("content.beforeDelete", contentRef, hookCtx);
  } catch (err) {
    if (isHookAbortError(err)) {
      res.status(403).json({ error: err.message });
      return;
    }
    throw err;
  }

  await db.run("DELETE FROM content WHERE id = ? AND site_id = ?", [id, session.siteId]);
  await invalidateContentCache();
  await hooks.dispatchAction("content.deleted", contentRef, hookCtx);
  res.json({ ok: true });
});

export default router;
