import { pgTable, uuid, varchar, boolean, jsonb, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";

export const pluginStatusEnum = pgEnum("plugin_status", [
  "installed",
  "active",
  "inactive",
  "error",
]);

export const plugins = pgTable("plugins", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  pluginId: varchar("plugin_id", { length: 255 }).notNull(),
  version: varchar("version", { length: 50 }).notNull(),
  status: pluginStatusEnum("status").notNull().default("installed"),
  manifest: jsonb("manifest").notNull(),
  approvedPermissions: jsonb("approved_permissions").notNull().default([]),
  safeMode: boolean("safe_mode").notNull().default(false),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Plugin = typeof plugins.$inferSelect;
export type NewPlugin = typeof plugins.$inferInsert;
