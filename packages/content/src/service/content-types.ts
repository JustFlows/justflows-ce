// SPDX-License-Identifier: MIT

import { z } from "zod";

export const CONTENT_TYPE_FIELD_KINDS = [
  "text",
  "textarea",
  "richtext",
  "number",
  "boolean",
  "media",
  "date",
  "select",
] as const;

export type ContentFieldKind = (typeof CONTENT_TYPE_FIELD_KINDS)[number];

export const BUILTIN_CONTENT_TYPE_SLUGS = ["post", "page"] as const;
export type BuiltinContentTypeSlug = (typeof BUILTIN_CONTENT_TYPE_SLUGS)[number];

export const BUILTIN_CONTENT_TYPES: ReadonlyArray<{
  slug: BuiltinContentTypeSlug;
  label: string;
  description: string;
}> = [
  { slug: "post", label: "Post", description: "Blog post" },
  { slug: "page", label: "Page", description: "Static page" },
];

/** Fields reserved for core SEO — custom types cannot reuse these keys. */
export const RESERVED_FIELD_KEYS = [
  "seoTitle",
  "seoDescription",
  "seoCanonical",
  "seoImage",
] as const;

export const ContentTypeSlugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,59}$/, "Slug must be lowercase letters, numbers, and hyphens");

export const ContentFieldKeySchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9_]{0,59}$/, "Field key must start with a letter");

export const ContentFieldDefinitionSchema = z.object({
  key: ContentFieldKeySchema,
  label: z.string().trim().min(1).max(255),
  type: z.enum(CONTENT_TYPE_FIELD_KINDS),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
});

export type ContentFieldDefinition = z.infer<typeof ContentFieldDefinitionSchema>;

export const ContentTypeFieldsSchema = z
  .array(ContentFieldDefinitionSchema)
  .max(50)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < fields.length; i += 1) {
      const key = fields[i]!.key;
      if (RESERVED_FIELD_KEYS.includes(key as (typeof RESERVED_FIELD_KEYS)[number])) {
        ctx.addIssue({
          code: "custom",
          path: [i, "key"],
          message: `Field key "${key}" is reserved for SEO`,
        });
      }
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: [i, "key"],
          message: `Duplicate field key "${key}"`,
        });
      }
      seen.add(key);
      if (fields[i]!.type === "select" && !(fields[i]!.options?.length)) {
        ctx.addIssue({
          code: "custom",
          path: [i, "options"],
          message: "Select fields need at least one option",
        });
      }
    }
  });

export function isBuiltinContentTypeSlug(slug: string): slug is BuiltinContentTypeSlug {
  return (BUILTIN_CONTENT_TYPE_SLUGS as readonly string[]).includes(slug);
}

export function normalizeContentTypeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}
