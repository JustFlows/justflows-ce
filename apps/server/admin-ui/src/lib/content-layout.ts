export function usesBlockEditor(type: string, editorIsBlocks: boolean): boolean {
  return type === "page" || type === "account" || type === "auth" || editorIsBlocks;
}

export function isEmptyBlockDocument(blocks: { blocks?: unknown } | null | undefined): boolean {
  return !blocks || !Array.isArray(blocks.blocks) || blocks.blocks.length === 0;
}

/** Seed a same-named pattern only on the original locale, not on an empty translation. */
export function shouldSeedTypePattern(item: {
  id?: string;
  translationGroupId?: string | null;
  status?: string;
}): boolean {
  if (!item.id) return true;
  /**
   * Only a draft starts from the type's pattern. A published entry with no
   * blocks (one a plugin created, say) opens as it is stored; seeding it would
   * count as an edit, and autosave would turn it into a new draft.
   */
  if (item.status && item.status !== "draft") return false;
  return !item.translationGroupId || item.translationGroupId === item.id;
}

export async function fetchTypePattern(type: string): Promise<{ version: 1; blocks: unknown[] } | null> {
  if (!/^[a-z][a-z0-9-]{0,59}$/.test(type)) return null;
  try {
    const res = await fetch(`/api/themes/patterns/${encodeURIComponent(type)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { pattern?: { blocks?: unknown[] } };
    if (!Array.isArray(data.pattern?.blocks) || data.pattern.blocks.length === 0) return null;
    return { version: 1, blocks: data.pattern.blocks };
  } catch {
    return null;
  }
}
