// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  ContentTypeSettingsSchema,
  resolveContentTypeSettings,
} from "../../src/service/content-type-settings.js";

describe("content type settings", () => {
  it("preserves existing behavior when no overrides are stored", () => {
    expect(resolveContentTypeSettings("post")).toMatchObject({
      editor: "auto",
      revisions: true,
      preview: true,
      seo: true,
      search: null,
      comments: "inherit",
      quickAction: null,
    });
  });
  it.each(["account", "auth"])(
    "keeps %s private even when settings request public features",
    (slug) => {
      expect(
        resolveContentTypeSettings(slug, { search: true, seo: true, comments: "enabled" }),
      ).toMatchObject({ search: false, seo: false, comments: "disabled" });
    },
  );
  it("ignores retired keys in stored settings without losing the rest", () => {
    expect(
      resolveContentTypeSettings("post", { navigationGroup: "Shop", pluralLabel: "Articles" }),
    ).toMatchObject({ pluralLabel: "Articles" });
  });
  it("rejects invalid switches and limits label input", () => {
    expect(ContentTypeSettingsSchema.safeParse({ revisions: "false" }).success).toBe(false);
    expect(ContentTypeSettingsSchema.safeParse({ pluralLabel: "a".repeat(256) }).success).toBe(
      false,
    );
    expect(ContentTypeSettingsSchema.safeParse({ navigationGroup: "Shop" }).success).toBe(false);
    expect(ContentTypeSettingsSchema.safeParse({ editor: "unknown" }).success).toBe(false);
  });
});
