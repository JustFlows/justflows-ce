import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";

export const contentTypes = pgTable("content_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  slug: varchar("slug", { length: 60 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  description: text("description").notNull().default(""),
  isBuiltin: boolean("is_builtin").notNull().default(false),
  fields: jsonb("fields").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ContentTypeRow = typeof contentTypes.$inferSelect;
export type NewContentTypeRow = typeof contentTypes.$inferInsert;
