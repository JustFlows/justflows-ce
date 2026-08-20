import { pgTable, uuid, varchar, jsonb, timestamp } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";

export const siteSettings = pgTable("site_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  key: varchar("key", { length: 255 }).notNull(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SiteSetting = typeof siteSettings.$inferSelect;
export type NewSiteSetting = typeof siteSettings.$inferInsert;
