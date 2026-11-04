// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "../../../src/lib/database/db.js";
import type { PortableBackupEnvelope } from "../../../src/lib/backup/portable-archive.js";
import { restoreSiteBackup } from "../../../src/lib/backup/site-restore.js";

describe("clean-site restore", () => {
  it("rewrites site ownership, clears imported authors, and preserves target secrets", async () => {
    const run = vi.fn<(sql: string, params?: (string | number | boolean | null)[]) => Promise<void>>(async () => undefined);
    const query: DbClient["query"] = async <T>(sql: string) =>
      (sql.includes("item_count")
        ? [{ item_count: 0 }]
        : [{ id: "setting-secret", site_id: "target", key: "provider_api_key", value: "encrypted" }]) as T[];
    const db = {
      run,
      query,
      execute: vi.fn(),
      transaction: async (fn: (tx: Pick<DbClient, "run" | "query" | "execute">) => Promise<unknown>) =>
        fn({ run, query, execute: vi.fn() }),
      close: vi.fn(),
    } as unknown as DbClient;
    const backup = {
      source: { siteId: "source", siteName: "Source", databaseDriver: "postgres" },
      data: {
        files: [],
        extensions: { plugins: [], themes: [] },
        tables: {
          content: [{ id: "content-1", site_id: "source", title: "Home", author_id: "old-user" }],
          site_settings: [{ id: "setting-public", site_id: "source", key: "site_title", value: "Source" }],
        },
      },
    } as unknown as PortableBackupEnvelope;

    await restoreSiteBackup(db, "target", backup);

    const inserts = run.mock.calls.filter(([sql]) => String(sql).startsWith("INSERT INTO"));
    const content = inserts.find(([sql]) => String(sql).startsWith("INSERT INTO content "));
    expect(content?.[1]).toContain("target");
    expect(content?.[1]).toContain(null);
    expect(inserts.filter(([sql]) => String(sql).startsWith("INSERT INTO site_settings "))).toHaveLength(2);
  });

  it("refuses a target that already contains user content", async () => {
    const db = { query: vi.fn(async () => [{ item_count: 1 }]) } as unknown as DbClient;
    await expect(restoreSiteBackup(db, "target", {} as PortableBackupEnvelope)).rejects.toThrow("requires a clean site");
  });
});
