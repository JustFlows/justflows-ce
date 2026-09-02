// SPDX-License-Identifier: MIT
import { pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";
import { users } from "./users.js";

export const accessRoles = pgTable("access_roles", {
  id: varchar("id", { length: 80 }).primaryKey(),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  description: varchar("description", { length: 500 }),
  capabilitiesJson: text("capabilities_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("uq_access_roles_site_name").on(table.siteId, table.name)]);

export const userAccessPolicies = pgTable("user_access_policies", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  roleId: varchar("role_id", { length: 80 }).references(() => accessRoles.id, { onDelete: "set null" }),
  grantsJson: text("grants_json").notNull(),
  deniesJson: text("denies_json").notNull(),
  scopesJson: text("scopes_json").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userSessions = pgTable("user_sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  userAgent: varchar("user_agent", { length: 255 }),
  ip: varchar("ip", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
