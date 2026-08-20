import { pgTable, uuid, varchar, text, boolean, jsonb, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";

export const themeStatusEnum = pgEnum("theme_status", [
  "installed",
  "active",
  "inactive",
  "error",
]);

export const themes = pgTable("themes", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  themeId: varchar("theme_id", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  version: varchar("version", { length: 50 }).notNull(),
  publisher: varchar("publisher", { length: 255 }).notNull(),
  description: text("description"),
  status: themeStatusEnum("status").notNull().default("installed"),
  /** CSS custom properties as a JSON object: { "--color-primary": "#3b82f6", ... } */
  cssVariables: jsonb("css_variables").notNull().default({}),
  /** Full manifest jsonb for future use */
  manifest: jsonb("manifest").notNull(),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Theme = typeof themes.$inferSelect;
export type NewTheme = typeof themes.$inferInsert;
