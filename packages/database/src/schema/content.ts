import { pgTable, uuid, varchar, text, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";
import { users } from "./users.js";

export const contentStatusEnum = pgEnum("content_status", [
  "draft",
  "published",
  "unpublished",
  "trashed",
]);

export const content = pgTable("content", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 60 }).notNull().default("post"),
  title: varchar("title", { length: 1024 }).notNull(),
  slug: varchar("slug", { length: 1024 }).notNull(),
  excerpt: text("excerpt"),
  blocks: jsonb("blocks").notNull().default([]),
  status: contentStatusEnum("status").notNull().default("draft"),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Content = typeof content.$inferSelect;
export type NewContent = typeof content.$inferInsert;
