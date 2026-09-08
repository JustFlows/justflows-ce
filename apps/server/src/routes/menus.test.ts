// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

describe("menu routes", () => {
  it("loads without throwing while building the extended item/design Zod schemas", async () => {
    const module = await import("./menus.js");
    expect(module.default).toBeDefined();
  });
});
