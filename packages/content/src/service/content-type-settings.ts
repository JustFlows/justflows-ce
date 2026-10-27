// SPDX-License-Identifier: MIT
import { z } from "zod";
import { contentTypePolicy } from "./content-types.js";

/** Optional overrides preserve the behavior of existing installations. */
export const ContentTypeSettingsSchema = z
  .object({
    pluralLabel: z.string().trim().max(255).default(""),
    quickAction: z.boolean().nullable().default(null),
    editor: z.enum(["auto", "blocks", "fields"]).default("auto"),
    revisions: z.boolean().default(true),
    preview: z.boolean().default(true),
    search: z.boolean().nullable().default(null),
    seo: z.boolean().default(true),
    comments: z.enum(["inherit", "enabled", "disabled"]).default("inherit"),
  })
  .strict();
export type ContentTypeSettings = z.infer<typeof ContentTypeSettingsSchema>;

/** Privacy-sensitive built-ins cannot be made discoverable by type settings. */
export function resolveContentTypeSettings(slug: string, raw?: unknown): ContentTypeSettings {
  /** Stored rows may carry retired keys; drop them instead of resetting every setting. */
  const parsed = ContentTypeSettingsSchema.strip().safeParse(raw ?? {});
  const settings = parsed.success ? parsed.data : ContentTypeSettingsSchema.parse({});
  if (!contentTypePolicy(slug).publiclyDiscoverable) {
    return { ...settings, search: false, seo: false, comments: "disabled" };
  }
  return settings;
}
