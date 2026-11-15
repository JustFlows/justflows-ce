// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { coreBlocks, resolveInlineFields } from "../../src/index.js";

/**
 * Core blocks mark each declared in-place field with `data-jf-inline`, so the
 * builder edits the page's own markup (justflows-ce#311), as plugin blocks do.
 */

/** The media blocks move with media replacement in the last batch. */
const NOT_YET = new Set(["core.image", "core.video", "core.audio", "core.file"]);

describe("inline field markers", () => {
  const withFields = coreBlocks.filter((d) => Object.keys(resolveInlineFields(d.inline, true)).length > 0 && !NOT_YET.has(d.type));

  it.each(withFields.map((d) => [d.type, d] as const))("%s marks every declared field", (_type, definition) => {
    const fields = Object.keys(resolveInlineFields(definition.inline, true));
    const raw: Record<string, unknown> = { buttonUrl: "/go", url: "/go" };
    for (const field of fields) raw[field] = `Value of ${field}`;
    const html = definition.render(definition.validateProps(raw) as never, "");
    for (const field of fields) expect(html, field).toContain(`data-jf-inline="${field}"`);
  });
});
