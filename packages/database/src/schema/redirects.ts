// SPDX-License-Identifier: MIT
import {
  pgTable,
  uuid,
  varchar,
  text,
  bigint,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { sites } from "./sites.js";
export const redirects = pgTable(
  "redirects",
  {
    id: uuid("id").primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    rule: text("rule").notNull(),
  },
  (table) => [index("idx_redirects_site").on(table.siteId)],
);
export const redirectNotFound = pgTable(
  "redirect_not_found",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    pathHash: varchar("path_hash", { length: 64 }).notNull(),
    path: varchar("path", { length: 2048 }).notNull(),
    hits: bigint("hits", { mode: "number" }).notNull().default(1),
    referrer: varchar("referrer", { length: 512 }).notNull().default(""),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.pathHash] }),
    index("idx_redirect_not_found_seen").on(table.siteId, table.lastSeen),
  ],
);
