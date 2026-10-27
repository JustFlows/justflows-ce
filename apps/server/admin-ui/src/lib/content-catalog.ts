// SPDX-License-Identifier: MIT

/** Read every bounded API page before applying the catalog's local filters. */
export async function loadContentCatalog<T>(signal: AbortSignal): Promise<T[]> {
  const items: T[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/content?${params}`, { signal });
    if (!response.ok) throw new Error("Content catalog unavailable");
    const page = await response.json() as { items?: T[]; nextCursor?: string | null };
    if (!Array.isArray(page.items)) throw new Error("Invalid content catalog");
    items.push(...page.items);
    cursor = page.nextCursor ?? null;
    if (cursor) {
      if (cursors.has(cursor)) throw new Error("Repeated content cursor");
      cursors.add(cursor);
    }
  } while (cursor);
  return items;
}
