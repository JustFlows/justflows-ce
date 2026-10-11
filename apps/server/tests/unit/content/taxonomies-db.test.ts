// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

interface TaxonomyRow { id: string; site_id: string; slug: string; name: string; description: string; hierarchical: number; content_types: string }
interface TermRow { id: string; site_id: string; taxonomy_id: string; slug: string; name: string; description: string; parent_id: string | null }

let taxonomies: TaxonomyRow[];
let terms: TermRow[];
const statements: Array<{ sql: string; params: unknown[] }> = [];

const run = vi.fn(async (sql: string, params: unknown[] = []) => {
  statements.push({ sql, params });
  if (sql.startsWith("INSERT INTO taxonomies")) {
    const [id, site_id, slug, name, description, hierarchical, content_types] = params as [string, string, string, string, string, number, string];
    taxonomies.push({ id, site_id, slug, name, description, hierarchical, content_types });
  }
});
const query = vi.fn(async (sql: string, params: unknown[] = []) => {
  if (sql.startsWith("SELECT slug FROM taxonomies")) return taxonomies.filter((row) => row.site_id === params[0]);
  if (sql.includes("FROM taxonomies WHERE site_id = ? AND slug = ?"))
    return taxonomies.filter((row) => row.site_id === params[0] && row.slug === params[1]);
  if (sql.includes("FROM taxonomies WHERE site_id = ?")) return taxonomies.filter((row) => row.site_id === params[0]);
  if (sql.includes("AND t.taxonomy_id = ? AND t.id = ?"))
    return terms
      .filter((row) => row.site_id === params[0] && row.taxonomy_id === params[1] && row.id === params[2])
      .map((row) => ({ ...row, taxonomy: taxonomies.find((taxonomy) => taxonomy.id === row.taxonomy_id)!.slug }));
  if (sql.startsWith("SELECT id, parent_id FROM terms"))
    return terms.filter((row) => row.site_id === params[0] && row.taxonomy_id === params[1]);
  if (sql.startsWith("SELECT id, taxonomy_id FROM terms"))
    return terms.filter((row) => row.site_id === params[0] && params.slice(1).includes(row.id));
  return [];
});
vi.mock("../../../src/lib/database/db.js", () => ({
  getDb: async () => ({ query, run, transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ query, run }) }),
}));
vi.mock("../../../src/lib/content/content-types-db.js", () => ({
  listContentTypes: async () => [{ slug: "post" }, { slug: "page" }, { slug: "account" }, { slug: "recipe" }],
}));
const history = vi.fn(async (_siteId: string, mutate: () => Promise<unknown>) => mutate());
vi.mock("../../../src/lib/navigation/permalinks-db.js", () => ({
  reservedPermalinkPath: async (path: string) => path === "/api",
  withTermPermalinkHistory: (siteId: string, mutate: () => Promise<unknown>) => history(siteId, mutate),
}));

const { createTaxonomy, createTerm, listTaxonomies, setContentTerms, updateTerm, TaxonomyError } = await import(
  "../../../src/lib/content/taxonomies-db.js"
);

const CATEGORY = "00000000-0000-4000-8000-000000000001";
const TAG = "00000000-0000-4000-8000-000000000002";
const NEWS = "00000000-0000-4000-8000-0000000000a1";
const LOCAL = "00000000-0000-4000-8000-0000000000a2";
const RED = "00000000-0000-4000-8000-0000000000b1";

beforeEach(() => {
  vi.clearAllMocks();
  statements.length = 0;
  taxonomies = [
    { id: CATEGORY, site_id: "s1", slug: "category", name: "Categories", description: "", hierarchical: 1, content_types: '["post"]' },
    { id: TAG, site_id: "s1", slug: "tag", name: "Tags", description: "", hierarchical: 0, content_types: '["post"]' },
  ];
  terms = [
    { id: NEWS, site_id: "s1", taxonomy_id: CATEGORY, slug: "news", name: "News", description: "", parent_id: null },
    { id: LOCAL, site_id: "s1", taxonomy_id: CATEGORY, slug: "local", name: "Local", description: "", parent_id: NEWS },
    { id: RED, site_id: "s1", taxonomy_id: TAG, slug: "red", name: "Red", description: "", parent_id: null },
  ];
});

describe("built-in taxonomies", () => {
  it("seeds category and tag for posts on sites that have none", async () => {
    taxonomies = [];
    const list = await listTaxonomies("s2");
    expect(list.map((taxonomy) => [taxonomy.slug, taxonomy.hierarchical, taxonomy.builtin, taxonomy.contentTypes])).toEqual([
      ["category", true, true, ["post"]],
      ["tag", false, true, ["post"]],
    ]);
  });

  it("refuses built-in, reserved and unknown definitions", async () => {
    await expect(createTaxonomy("s1", { slug: "tag", name: "Tags" })).rejects.toThrow("reserved");
    await expect(createTaxonomy("s1", { slug: "api", name: "API" })).rejects.toThrow("reserved");
    await expect(createTaxonomy("s1", { slug: "genre", name: "Genres", contentTypes: ["nope"] })).rejects.toThrow("Unknown content type");
    await expect(createTaxonomy("s1", { slug: "genre", name: "Genres", contentTypes: ["account"] })).rejects.toThrow("cannot use");
    const genre = await createTaxonomy("s1", { slug: "genre", name: "Genres", contentTypes: ["recipe", "recipe"] });
    expect(genre).toMatchObject({ slug: "genre", builtin: false, contentTypes: ["recipe"] });
  });
});

describe("term hierarchy", () => {
  it("rejects parents in flat taxonomies and loops in hierarchical ones", async () => {
    await expect(createTerm("s1", "tag", { name: "Blue", parentId: RED })).rejects.toThrow("no parent");
    await expect(updateTerm("s1", "category", NEWS, { parentId: LOCAL })).rejects.toThrow("own ancestor");
    await expect(updateTerm("s1", "category", NEWS, { parentId: NEWS })).rejects.toThrow("own ancestor");
  });
});

describe("assigning terms to content", () => {
  it("replaces only the named taxonomies with one delete and one batched insert", async () => {
    await setContentTerms("s1", { id: "p1", type: "post" }, { category: [NEWS, LOCAL] });
    const writes = statements.filter(({ sql }) => /^(DELETE|INSERT)/.test(sql.trim()));
    expect(writes).toHaveLength(2);
    expect(writes[0]!.params).toEqual(["p1", "s1", CATEGORY]);
    expect(writes[1]!.sql).toContain("VALUES (?, ?), (?, ?)");
    expect(writes[1]!.params).toEqual(["p1", NEWS, "p1", LOCAL]);
    expect(history).toHaveBeenCalledOnce();
  });

  it("clears a taxonomy without inserting", async () => {
    await setContentTerms("s1", { id: "p1", type: "post" }, { tag: [] });
    expect(statements.filter(({ sql }) => sql.startsWith("INSERT"))).toHaveLength(0);
    expect(statements.filter(({ sql }) => sql.startsWith("DELETE"))).toHaveLength(1);
  });

  it("rejects taxonomies that do not apply and terms from another taxonomy", async () => {
    await expect(setContentTerms("s1", { id: "pg", type: "page" }, { category: [NEWS] })).rejects.toThrow("does not apply");
    await expect(setContentTerms("s1", { id: "p1", type: "post" }, { category: [RED] })).rejects.toBeInstanceOf(TaxonomyError);
    await expect(setContentTerms("s1", { id: "p1", type: "post" }, { genre: [] })).rejects.toThrow("Unknown taxonomy");
    expect(run).not.toHaveBeenCalled();
  });
});
