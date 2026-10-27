// SPDX-License-Identifier: MIT
import { expect, it } from "vitest";
import { contentTypeQuickActions } from "../../src/lib/content-type-navigation";

it("keeps page/post shortcuts by default and honors explicit overrides", () => {
  expect(
    contentTypeQuickActions([
      { slug: "post", label: "Post", settings: { quickAction: false } },
      { slug: "page", label: "Page" },
      { slug: "product", label: "Product", settings: { quickAction: true } },
    ]).map((type) => type.slug),
  ).toEqual(["page", "product"]);
});
