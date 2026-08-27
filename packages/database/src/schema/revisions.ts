// SPDX-License-Identifier: MIT

import { integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";
import { users } from "./users.js";
import { content } from "./content.js";

export const revisions = pgTable("revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  contentId: uuid("content_id")
    .notNull()
    .references(() => content.id, { onDelete: "cascade" }),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 1024 }).notNull(),
  slug: varchar("slug", { length: 1024 }).notNull().default(""),
  excerpt: text("excerpt"),
  locale: varchar("locale", { length: 20 }),
  translationGroupId: uuid("translation_group_id"),
  blocks: jsonb("blocks").notNull().default([]),
  fields: jsonb("fields").notNull().default({}),
  version: integer("version").notNull().default(1),
  baseVersion: integer("base_version").notNull().default(1),
  kind: varchar("kind", { length: 20 }).notNull().default("historical"),
  source: varchar("source", { length: 20 }).notNull().default("manual"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RevisionRow = typeof revisions.$inferSelect;
export type NewRevisionRow = typeof revisions.$inferInsert;
