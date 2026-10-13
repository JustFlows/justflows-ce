// SPDX-License-Identifier: MIT

export interface Taxonomy {
  id: string;
  slug: string;
  name: string;
  description: string;
  hierarchical: boolean;
  builtin: boolean;
  contentTypes: string[];
}

export interface Term {
  id: string;
  taxonomy: string;
  slug: string;
  name: string;
  description: string;
  parentId: string | null;
  count: number;
}

export interface TermRef {
  id: string;
  taxonomy: string;
  slug: string;
  name: string;
}

/** Depth-first order with each term's depth; orphans and loops fall back to the top level. */
export function termTree(terms: Term[]): Array<{ term: Term; depth: number }> {
  const ids = new Set(terms.map((term) => term.id));
  const children = new Map<string | null, Term[]>();
  for (const term of terms) {
    const parent = term.parentId && ids.has(term.parentId) ? term.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), term]);
  }
  const out: Array<{ term: Term; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const term of children.get(parent) ?? []) {
      if (seen.has(term.id)) continue;
      seen.add(term.id);
      out.push({ term, depth });
      walk(term.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const term of terms) if (!seen.has(term.id)) out.push({ term, depth: 0 });
  return out;
}

/** Every id below `id`, so a term cannot be moved under its own descendant. */
export function descendantIds(terms: Term[], id: string): Set<string> {
  const out = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const term of terms)
      if (term.parentId === current && !out.has(term.id)) {
        out.add(term.id);
        queue.push(term.id);
      }
  }
  return out;
}
