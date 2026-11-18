// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

describe("menu routes", () => {
  it("loads without throwing while building the extended item/design Zod schemas", async () => {
    const module = await import("../../../../src/routes/design/menus.js");
    expect(module.default).toBeDefined();
  });

  it("accepts canonical database UUIDs with historical version and variant bits", async () => {
    const { MenuContentIdSchema } = await import("../../../../src/routes/design/menus.js");

    expect(MenuContentIdSchema.parse("b4cb3827-18e7-481c-1e77-baddc3332632")).toBe(
      "b4cb3827-18e7-481c-1e77-baddc3332632",
    );
    expect(MenuContentIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});
