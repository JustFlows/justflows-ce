// SPDX-License-Identifier: MIT
import type { BlockSchema } from "../registry/block-registry.js";

type Conditions = Record<string, NonNullable<BlockSchema[string]["showWhen"]>>;

const VIDEO = { field: "mediaType", equals: "video" };
const NUMBERED = { field: "listStyle", equals: "numbered" };
const PAGINATED = { field: "pagination", equals: "true" };

/** Core fields whose effect depends on another field; validation still preserves hidden values. */
const CONDITIONS: Record<string, Conditions> = {
  list: { start: NUMBERED, reversed: NUMBERED, marker: { field: "listStyle", equals: ["bullet", "numbered"] } },
  cover: { poster: VIDEO, loop: VIDEO, playLabel: VIDEO, pauseLabel: VIDEO, alt: { field: "mediaType", equals: "image" } },
  "media-text": { poster: VIDEO, alt: { field: "mediaType", equals: "image" } },
  callout: { dismissLabel: { field: "dismissible", equals: "true" } },
  navigation: {
    source: { field: "menuSlug", equals: "" },
    menuLabel: { field: "mobileCollapse", equals: "true" },
    mobilePattern: { field: "mobileCollapse", equals: "true" },
  },
  breadcrumbs: { separator: { field: "showCurrent", equals: "true" } },
  "content-query": {
    columns: { field: "layout", equals: "grid" },
    pageKey: PAGINATED,
    previousLabel: PAGINATED,
    nextLabel: PAGINATED,
  },
};

/** Add inspector hints without changing stored props or public rendering. */
export function withCoreInspectorConditions(type: string, schema: BlockSchema): BlockSchema {
  const conditions = CONDITIONS[type];
  if (!conditions) return schema;
  return Object.fromEntries(Object.entries(schema).map(([name, field]) => [
    name,
    conditions[name] ? { ...field, showWhen: conditions[name] } : field,
  ]));
}
