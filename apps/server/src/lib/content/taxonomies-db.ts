// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ContentTypeSlugSchema, contentTypePolicy, slugify } from "@justflows/content";
import { getDb } from "../database/db.js";
import { listContentTypes } from "./content-types-db.js";
import { reservedPermalinkPath, withTermPermalinkHistory } from "../navigation/permalinks-db.js";

/** Core taxonomies every site has. Their slugs back the `%category%` token and the category/tag bases. */
export const BUILTIN_TAXONOMIES = [
  { slug: "category", name: "Categories", hierarchical: true, contentTypes: ["post"] },
  { slug: "tag", name: "Tags", hierarchical: false, contentTypes: ["post"] },
] as const;

const BUILTIN_SLUGS = new Set<string>(BUILTIN_TAXONOMIES.map((taxonomy) => taxonomy.slug));
/** Terms one entry may carry per taxonomy. */
export const MAX_TERMS_PER_TAXONOMY = 100;

export const TermSlugSchema = z
  .string()
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers, and hyphens");

export const TaxonomyCreateSchema = z.object({
  slug: ContentTypeSlugSchema,
  name: z.string().trim().min(1).max(255),
  description: z.string().max(2000).optional(),
  hierarchical: z.boolean().optional(),
  contentTypes: z.array(ContentTypeSlugSchema).max(100).optional(),
});

export const TaxonomyPatchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  contentTypes: z.array(ContentTypeSlugSchema).max(100).optional(),
});

export const TermCreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: TermSlugSchema.optional(),
  description: z.string().max(2000).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export const TermPatchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  slug: TermSlugSchema.optional(),
  description: z.string().max(2000).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

/** `{ taxonomySlug: termIds }`; taxonomies left out keep their current terms. */
export const ContentTermsSchema = z.record(
  ContentTypeSlugSchema,
  z.array(z.string().uuid()).max(MAX_TERMS_PER_TAXONOMY),
);

export interface TaxonomyDefinition {
  id: string;
  slug: string;
  name: string;
  description: string;
  hierarchical: boolean;
  builtin: boolean;
  contentTypes: string[];
}

export interface TermDefinition {
  id: string;
  taxonomy: string;
  slug: string;
  name: string;
  description: string;
  parentId: string | null;
  /** Non-trashed entries carrying this term. */
  count: number;
}

export interface ContentTermRef {
  id: string;
  taxonomy: string;
  slug: string;
  name: string;
}

/** Validation and lookup failures the routes map to 4xx responses. */
export class TaxonomyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

interface TaxonomyRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  hierarchical: boolean | number | string;
  content_types: unknown;
}

interface TermRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  taxonomy: string;
  count?: number | string | null;
}

function toBool(value: boolean | number | string): boolean {
  return value === true || value === 1 || value === "1" || value === "t";
}

function dbBool(value: boolean): boolean | number {
  return process.env.DB_DRIVER === "postgres" ? value : value ? 1 : 0;
}

function parseSlugs(raw: unknown): string[] {
  let parsed = raw;
  try {
    if (Buffer.isBuffer(raw)) parsed = JSON.parse(raw.toString("utf8"));
    else if (typeof raw === "string") parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter((slug): slug is string => typeof slug === "string") : [];
}

function serializeTaxonomy(row: TaxonomyRow): TaxonomyDefinition {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description ?? ""),
    hierarchical: toBool(row.hierarchical),
    builtin: BUILTIN_SLUGS.has(String(row.slug)),
    contentTypes: parseSlugs(row.content_types),
  };
}

function serializeTerm(row: TermRow): TermDefinition {
  return {
    id: String(row.id),
    taxonomy: String(row.taxonomy),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description ?? ""),
    parentId: row.parent_id ? String(row.parent_id) : null,
    count: Number(row.count ?? 0),
  };
}

function isDuplicate(err: unknown): boolean {
  const message = String(err).toLowerCase();
  return message.includes("unique") || message.includes("duplicate");
}

/** Seed the core taxonomies on sites that predate them. */
export async function ensureBuiltinTaxonomies(siteId: string): Promise<void> {
  const db = await getDb();
  const existing = await db.query<{ slug: string }>("SELECT slug FROM taxonomies WHERE site_id = ?", [siteId]);
  const have = new Set(existing.map((row) => String(row.slug)));
  for (const taxonomy of BUILTIN_TAXONOMIES) {
    if (have.has(taxonomy.slug)) continue;
    try {
      await db.run(
        "INSERT INTO taxonomies (id, site_id, slug, name, description, hierarchical, content_types) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [randomUUID(), siteId, taxonomy.slug, taxonomy.name, "", dbBool(taxonomy.hierarchical), JSON.stringify(taxonomy.contentTypes)],
      );
    } catch (err) {
      // A concurrent request seeded it first.
      if (!isDuplicate(err)) throw err;
    }
  }
}

export async function listTaxonomies(siteId: string): Promise<TaxonomyDefinition[]> {
  await ensureBuiltinTaxonomies(siteId);
  const db = await getDb();
  const rows = await db.query<TaxonomyRow>(
    "SELECT id, slug, name, description, hierarchical, content_types FROM taxonomies WHERE site_id = ? ORDER BY slug",
    [siteId],
  );
  return rows.map(serializeTaxonomy).sort((a, b) => Number(b.builtin) - Number(a.builtin));
}

export async function getTaxonomy(siteId: string, slug: string): Promise<TaxonomyDefinition | null> {
  await ensureBuiltinTaxonomies(siteId);
  const db = await getDb();
  const rows = await db.query<TaxonomyRow>(
    "SELECT id, slug, name, description, hierarchical, content_types FROM taxonomies WHERE site_id = ? AND slug = ? LIMIT 1",
    [siteId, slug],
  );
  return rows[0] ? serializeTaxonomy(rows[0]) : null;
}

async function requireTaxonomy(siteId: string, slug: string): Promise<TaxonomyDefinition> {
  const taxonomy = await getTaxonomy(siteId, slug);
  if (!taxonomy) throw new TaxonomyError("Taxonomy not found", 404);
  return taxonomy;
}

/** Only existing, publicly routed content types can carry terms. */
async function validContentTypes(siteId: string, slugs: string[]): Promise<string[]> {
  const known = new Set((await listContentTypes(siteId)).map((type) => type.slug));
  const unique = [...new Set(slugs)];
  for (const slug of unique) {
    if (!known.has(slug)) throw new TaxonomyError(`Unknown content type: ${slug}`, 400);
    if (contentTypePolicy(slug).requiresAuthentication)
      throw new TaxonomyError(`Content type ${slug} cannot use taxonomies`, 400);
  }
  return unique;
}

export async function createTaxonomy(
  siteId: string,
  input: z.infer<typeof TaxonomyCreateSchema>,
): Promise<TaxonomyDefinition> {
  await ensureBuiltinTaxonomies(siteId);
  if (BUILTIN_SLUGS.has(input.slug) || (await reservedPermalinkPath(`/${input.slug}`)))
    throw new TaxonomyError("This slug is reserved", 409);
  const contentTypes = await validContentTypes(siteId, input.contentTypes ?? []);
  const db = await getDb();
  try {
    await db.run(
      "INSERT INTO taxonomies (id, site_id, slug, name, description, hierarchical, content_types) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), siteId, input.slug, input.name, input.description ?? "", dbBool(input.hierarchical ?? false), JSON.stringify(contentTypes)],
    );
  } catch (err) {
    if (isDuplicate(err)) throw new TaxonomyError("A taxonomy with this slug already exists", 409);
    throw err;
  }
  return requireTaxonomy(siteId, input.slug);
}

export async function updateTaxonomy(
  siteId: string,
  slug: string,
  patch: z.infer<typeof TaxonomyPatchSchema>,
): Promise<TaxonomyDefinition> {
  const existing = await requireTaxonomy(siteId, slug);
  const sets: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    values.push(patch.name);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    values.push(patch.description);
  }
  if (patch.contentTypes !== undefined) {
    sets.push("content_types = ?");
    values.push(JSON.stringify(await validContentTypes(siteId, patch.contentTypes)));
  }
  if (!sets.length) return existing;
  const db = await getDb();
  await db.run(`UPDATE taxonomies SET ${sets.join(", ")} WHERE id = ? AND site_id = ?`, [...values, existing.id, siteId]);
  return requireTaxonomy(siteId, slug);
}

export async function deleteTaxonomy(siteId: string, slug: string): Promise<void> {
  const existing = await requireTaxonomy(siteId, slug);
  if (existing.builtin) throw new TaxonomyError("Cannot delete a built-in taxonomy", 409);
  const db = await getDb();
  // Terms and their assignments cascade with the taxonomy.
  await withTermPermalinkHistory(siteId, () =>
    db.run("DELETE FROM taxonomies WHERE id = ? AND site_id = ?", [existing.id, siteId]),
  );
}

const TERM_COLUMNS = "t.id, t.slug, t.name, t.description, t.parent_id, x.slug AS taxonomy";

export async function listTerms(siteId: string, taxonomySlug: string): Promise<TermDefinition[]> {
  const taxonomy = await requireTaxonomy(siteId, taxonomySlug);
  const db = await getDb();
  const rows = await db.query<TermRow>(
    `SELECT ${TERM_COLUMNS},
       (SELECT COUNT(*) FROM content_terms ct JOIN content c ON c.id = ct.content_id
        WHERE ct.term_id = t.id AND c.site_id = t.site_id AND c.trashed_at IS NULL) AS count
     FROM terms t JOIN taxonomies x ON x.id = t.taxonomy_id
     WHERE t.site_id = ? AND t.taxonomy_id = ? ORDER BY t.name, t.id`,
    [siteId, taxonomy.id],
  );
  return rows.map(serializeTerm);
}

async function getTerm(siteId: string, taxonomyId: string, termId: string): Promise<TermDefinition | null> {
  const db = await getDb();
  const rows = await db.query<TermRow>(
    `SELECT ${TERM_COLUMNS} FROM terms t JOIN taxonomies x ON x.id = t.taxonomy_id
     WHERE t.site_id = ? AND t.taxonomy_id = ? AND t.id = ? LIMIT 1`,
    [siteId, taxonomyId, termId],
  );
  return rows[0] ? serializeTerm(rows[0]) : null;
}

/** A term slug is the URL-safe name; names without Latin characters fall back to a numbered slug. */
async function freeTermSlug(siteId: string, taxonomyId: string, name: string): Promise<string> {
  const base = slugify(name).replace(/^-+|-+$/g, "").slice(0, 190) || "term";
  const db = await getDb();
  const rows = await db.query<{ slug: string }>(
    "SELECT slug FROM terms WHERE site_id = ? AND taxonomy_id = ? AND (slug = ? OR slug LIKE ?)",
    [siteId, taxonomyId, base, `${base}-%`],
  );
  const taken = new Set(rows.map((row) => String(row.slug)));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

/** Parents must live in the same hierarchical taxonomy and never loop back to the term. */
async function validParent(
  siteId: string,
  taxonomy: TaxonomyDefinition,
  parentId: string | null | undefined,
  termId?: string,
): Promise<string | null> {
  if (!parentId) return null;
  if (!taxonomy.hierarchical) throw new TaxonomyError("This taxonomy has no parent terms", 400);
  const db = await getDb();
  const rows = await db.query<{ id: string; parent_id: string | null }>(
    "SELECT id, parent_id FROM terms WHERE site_id = ? AND taxonomy_id = ?",
    [siteId, taxonomy.id],
  );
  const parents = new Map(rows.map((row) => [String(row.id), row.parent_id ? String(row.parent_id) : null]));
  if (!parents.has(parentId)) throw new TaxonomyError("Parent term not found", 400);
  for (let cursor: string | null = parentId, depth = 0; cursor; cursor = parents.get(cursor) ?? null, depth++) {
    if (cursor === termId || depth > parents.size) throw new TaxonomyError("A term cannot be its own ancestor", 400);
  }
  return parentId;
}

export async function createTerm(
  siteId: string,
  taxonomySlug: string,
  input: z.infer<typeof TermCreateSchema>,
): Promise<TermDefinition> {
  const taxonomy = await requireTaxonomy(siteId, taxonomySlug);
  const parentId = await validParent(siteId, taxonomy, input.parentId);
  const slug = input.slug ?? (await freeTermSlug(siteId, taxonomy.id, input.name));
  const id = randomUUID();
  const db = await getDb();
  try {
    await withTermPermalinkHistory(siteId, () =>
      db.run(
        "INSERT INTO terms (id, site_id, taxonomy_id, slug, name, description, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, siteId, taxonomy.id, slug, input.name, input.description ?? "", parentId],
      ),
    );
  } catch (err) {
    if (isDuplicate(err)) throw new TaxonomyError("A term with this slug already exists", 409);
    throw err;
  }
  return { ...(await getTerm(siteId, taxonomy.id, id))!, count: 0 };
}

export async function updateTerm(
  siteId: string,
  taxonomySlug: string,
  termId: string,
  patch: z.infer<typeof TermPatchSchema>,
): Promise<TermDefinition> {
  const taxonomy = await requireTaxonomy(siteId, taxonomySlug);
  const existing = await getTerm(siteId, taxonomy.id, termId);
  if (!existing) throw new TaxonomyError("Term not found", 404);
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    values.push(patch.name);
  }
  if (patch.slug !== undefined) {
    sets.push("slug = ?");
    values.push(patch.slug);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    values.push(patch.description);
  }
  if (patch.parentId !== undefined) {
    sets.push("parent_id = ?");
    values.push(await validParent(siteId, taxonomy, patch.parentId, termId));
  }
  if (sets.length) {
    const db = await getDb();
    try {
      await withTermPermalinkHistory(siteId, () =>
        db.run(`UPDATE terms SET ${sets.join(", ")} WHERE id = ? AND site_id = ? AND taxonomy_id = ?`, [
          ...values,
          termId,
          siteId,
          taxonomy.id,
        ]),
      );
    } catch (err) {
      if (isDuplicate(err)) throw new TaxonomyError("A term with this slug already exists", 409);
      throw err;
    }
  }
  return (await listTerms(siteId, taxonomySlug)).find((term) => term.id === termId)!;
}

export async function deleteTerm(siteId: string, taxonomySlug: string, termId: string): Promise<void> {
  const taxonomy = await requireTaxonomy(siteId, taxonomySlug);
  const existing = await getTerm(siteId, taxonomy.id, termId);
  if (!existing) throw new TaxonomyError("Term not found", 404);
  const db = await getDb();
  await withTermPermalinkHistory(siteId, () =>
    db.transaction(async (tx) => {
      // Children move up a level instead of losing their place in the tree.
      await tx.run("UPDATE terms SET parent_id = ? WHERE parent_id = ? AND site_id = ?", [existing.parentId, termId, siteId]);
      await tx.run("DELETE FROM content_terms WHERE term_id = ?", [termId]);
      await tx.run("DELETE FROM terms WHERE id = ? AND site_id = ?", [termId, siteId]);
    }),
  );
}

/** Terms attached to several entries, in one query. */
export async function listContentTerms(siteId: string, contentIds: string[]): Promise<Map<string, ContentTermRef[]>> {
  const byContent = new Map<string, ContentTermRef[]>();
  if (!contentIds.length) return byContent;
  const db = await getDb();
  const rows = await db.query<{ content_id: string; id: string; slug: string; name: string; taxonomy: string }>(
    `SELECT ct.content_id, t.id, t.slug, t.name, x.slug AS taxonomy
     FROM content_terms ct JOIN terms t ON t.id = ct.term_id JOIN taxonomies x ON x.id = t.taxonomy_id
     WHERE t.site_id = ? AND ct.content_id IN (${contentIds.map(() => "?").join(", ")})
     ORDER BY x.slug, t.name, t.id`,
    [siteId, ...contentIds],
  );
  for (const row of rows) {
    const list = byContent.get(String(row.content_id)) ?? [];
    list.push({ id: String(row.id), taxonomy: String(row.taxonomy), slug: String(row.slug), name: String(row.name) });
    byContent.set(String(row.content_id), list);
  }
  return byContent;
}

export async function getContentTerms(siteId: string, contentId: string): Promise<ContentTermRef[]> {
  return (await listContentTerms(siteId, [contentId])).get(contentId) ?? [];
}

/**
 * Replace an entry's terms for each taxonomy named in `assignments`. Every
 * taxonomy must apply to the entry's type and every term must belong to it.
 */
export async function setContentTerms(
  siteId: string,
  content: { id: string; type: string },
  assignments: z.infer<typeof ContentTermsSchema>,
): Promise<ContentTermRef[]> {
  const slugs = Object.keys(assignments);
  if (!slugs.length) return getContentTerms(siteId, content.id);
  const taxonomies = new Map((await listTaxonomies(siteId)).map((taxonomy) => [taxonomy.slug, taxonomy]));
  for (const slug of slugs) {
    const taxonomy = taxonomies.get(slug);
    if (!taxonomy) throw new TaxonomyError(`Unknown taxonomy: ${slug}`, 400);
    if (!taxonomy.contentTypes.includes(content.type))
      throw new TaxonomyError(`Taxonomy ${slug} does not apply to ${content.type}`, 400);
  }
  const taxonomyIds = slugs.map((slug) => taxonomies.get(slug)!.id);
  const wanted = [...new Set(Object.values(assignments).flat())];
  const db = await getDb();
  if (wanted.length) {
    const rows = await db.query<{ id: string; taxonomy_id: string }>(
      `SELECT id, taxonomy_id FROM terms WHERE site_id = ? AND id IN (${wanted.map(() => "?").join(", ")})`,
      [siteId, ...wanted],
    );
    const owner = new Map(rows.map((row) => [String(row.id), String(row.taxonomy_id)]));
    for (const slug of slugs)
      for (const termId of assignments[slug]!)
        if (owner.get(termId) !== taxonomies.get(slug)!.id)
          throw new TaxonomyError(`Term ${termId} does not belong to ${slug}`, 400);
  }
  await withTermPermalinkHistory(siteId, () =>
    db.transaction(async (tx) => {
      await tx.run(
        `DELETE FROM content_terms WHERE content_id = ? AND term_id IN
           (SELECT id FROM terms WHERE site_id = ? AND taxonomy_id IN (${taxonomyIds.map(() => "?").join(", ")}))`,
        [content.id, siteId, ...taxonomyIds],
      );
      if (wanted.length)
        await tx.run(
          `INSERT INTO content_terms (content_id, term_id) VALUES ${wanted.map(() => "(?, ?)").join(", ")}`,
          wanted.flatMap((termId) => [content.id, termId]),
        );
    }),
  );
  return getContentTerms(siteId, content.id);
}
