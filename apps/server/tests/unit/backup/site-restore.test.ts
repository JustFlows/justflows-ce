// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "../../../src/lib/database/db.js";
import type { PortableBackupEnvelope } from "../../../src/lib/backup/portable-archive.js";

const upload = vi.hoisted(() => ({
  put: vi.fn(async () => undefined),
  move: vi.fn(async () => true),
  delete: vi.fn(async () => undefined),
}));

vi.mock("../../../src/lib/media/upload-store.js", () => ({
  getUploadStore: () => upload,
  isSafeUploadKey: (key: string) => Boolean(key) && !key.includes(".."),
}));

import { restoreSiteBackup } from "../../../src/lib/backup/site-restore.js";

describe("site restore", () => {
  it("puts existing media back when replacement fails", async () => {
    vi.clearAllMocks();
    const query: DbClient["query"] = async <T>(sql: string) =>
      (sql.includes("FROM media") ? [{ storage_key: "target/old.jpg" }] : []) as T[];
    const run = vi.fn(async (sql: string) => {
      if (sql.startsWith("INSERT INTO content ")) throw new Error("insert failed");
    });
    const db = {
      query,
      transaction: async (fn: (tx: Pick<DbClient, "run">) => Promise<unknown>) => fn({ run }),
    } as unknown as DbClient;
    const backup = {
      source: { siteId: "source", siteName: "Source", databaseDriver: "postgres" },
      data: {
        files: [],
        extensions: { plugins: [], themes: [] },
        tables: { content: [{ id: "content-1", title: "Replacement" }] },
      },
    } as unknown as PortableBackupEnvelope;

    await expect(restoreSiteBackup(db, "target", backup)).rejects.toThrow("insert failed");

    expect(upload.move).toHaveBeenCalledWith(
      "target/old.jpg",
      expect.stringContaining("target/.restore-rollback/"),
    );
    expect(upload.move).toHaveBeenLastCalledWith(
      expect.stringContaining("target/.restore-rollback/"),
      "target/old.jpg",
    );
  });

  it("rewrites site ownership, clears imported authors, and preserves target secrets", async () => {
    vi.clearAllMocks();
    const run = vi.fn<
      (sql: string, params?: (string | number | boolean | null)[]) => Promise<void>
    >(async () => undefined);
    const query: DbClient["query"] = async <T>(sql: string) =>
      (sql.includes("FROM media")
        ? []
        : [
            {
              id: "setting-secret",
              site_id: "target",
              key: "provider_api_key",
              value: "encrypted",
            },
          ]) as T[];
    const db = {
      run,
      query,
      execute: vi.fn(),
      transaction: async (
        fn: (tx: Pick<DbClient, "run" | "query" | "execute">) => Promise<unknown>,
      ) => fn({ run, query, execute: vi.fn() }),
      close: vi.fn(),
    } as unknown as DbClient;
    const backup = {
      source: { siteId: "source", siteName: "Source", databaseDriver: "postgres" },
      data: {
        files: [],
        extensions: { plugins: [], themes: [] },
        tables: {
          content: [{ id: "content-1", site_id: "source", title: "Home", author_id: "old-user" }],
          site_settings: [
            { id: "setting-public", site_id: "source", key: "site_title", value: "Source" },
          ],
        },
      },
    } as unknown as PortableBackupEnvelope;

    await restoreSiteBackup(db, "target", backup);

    const inserts = run.mock.calls.filter(([sql]) => String(sql).startsWith("INSERT INTO"));
    const content = inserts.find(([sql]) => String(sql).startsWith("INSERT INTO content "));
    expect(content?.[1]).toContain("target");
    expect(content?.[1]).toContain(null);
    expect(
      inserts.filter(([sql]) => String(sql).startsWith("INSERT INTO site_settings ")),
    ).toHaveLength(2);
  });
});
