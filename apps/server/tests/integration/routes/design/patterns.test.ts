// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

describe("pattern routes", () => {
  it("loads without deriving a partial schema from a refined Zod object", async () => {
    const module = await import("../../../../src/routes/design/patterns.js");
    expect(module.default).toBeDefined();
  });
});
