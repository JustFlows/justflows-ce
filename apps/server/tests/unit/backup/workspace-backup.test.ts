// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "../../../src/lib/database/db.js";

const getControlDb = vi.fn();
const getDb = vi.fn();
const exportSiteData = vi.fn();
const runWithDatabase = vi.fn((_db: DbClient, fn: () => Promise<unknown>) => fn());
const effectiveDatabaseMode = vi.fn(() => "current");

vi.mock("../../../src/lib/database/db.js", () => ({ getControlDb, getDb, runWithDatabase }));
vi.mock("../../../src/lib/backup/site-export.js", () => ({ exportSiteData }));
vi.mock("../../../src/lib/tenancy/choice.js", () => ({ effectiveDatabaseMode }));
vi.mock("../../../src/lib/tenancy/connections.js", () => ({
  separateDatabaseForSite: vi.fn(),
  borrowSeparateDatabase: vi.fn(),
}));

const { buildNetworkBackup, buildSubsiteBackups } = await import(
  "../../../src/lib/backup/workspace-backup.js"
);
const { openNetworkBackup } = await import("../../../src/lib/backup/network-archive.js");

describe("subsite backup files", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates one independent archive per tenant-bounded subsite", async () => {
    const query = vi.fn(async <T>(sql: string, params?: unknown[]) => {
      if (sql.startsWith("SELECT tenant_id")) return [{ tenant_id: "tenant-root" }] as T[];
      if (sql.includes("JOIN tenants"))
        return [
          { tenant_id: "tenant-root", database_choice: "current", database_mode: "current" },
        ] as T[];
      expect(sql).toContain("tenant_id = ? AND id <> ?");
      expect(params).toEqual(["tenant-root", "root"]);
      return [
        { id: "child-1", name: "First child" },
        { id: "child-2", name: "Second child" },
      ] as T[];
    }) as unknown as DbClient["query"];
    getControlDb.mockResolvedValue({ query } as unknown as DbClient);
    getDb.mockResolvedValue({} as DbClient);
    exportSiteData.mockImplementation(async (_db: DbClient, siteId: string) => ({
      tables: { sites: [{ id: siteId, name: siteId }] },
      extensions: { plugins: [], themes: [] },
      files: [],
    }));

    const files = await buildSubsiteBackups(
      "root",
      "2026-11-04T12:00:00.000Z",
      "postgres",
      "0.4.1",
    );

    expect(files.map((file) => file.siteId)).toEqual(["child-1", "child-2"]);
    expect(files.map((file) => file.filename)).toEqual([
      "justflows-subsite-first-child-2026-11-04.jfbackup",
      "justflows-subsite-second-child-2026-11-04.jfbackup",
    ]);
    expect(runWithDatabase).toHaveBeenCalledTimes(2);
  });

  it("bundles the root site and every subsite with their hostnames in one network archive", async () => {
    const query = vi.fn(async <T>(sql: string) => {
      if (sql.startsWith("SELECT tenant_id")) return [{ tenant_id: "tenant-root" }] as T[];
      if (sql.includes("JOIN tenants"))
        return [
          { tenant_id: "tenant-root", database_choice: "current", database_mode: "current" },
        ] as T[];
      if (sql.includes("FROM site_domains"))
        return [
          { site_id: "child-1", hostname: "alias.example.test", is_primary: 0 },
          { site_id: "child-1", hostname: "child.example.test", is_primary: 1 },
          { site_id: "root", hostname: "example.test", is_primary: true },
        ] as T[];
      return [{ id: "child-1", name: "First child" }] as T[];
    }) as unknown as DbClient["query"];
    getControlDb.mockResolvedValue({ query } as unknown as DbClient);
    getDb.mockResolvedValue({} as DbClient);
    exportSiteData.mockImplementation(async (_db: DbClient, siteId: string) => ({
      tables: { sites: [{ id: siteId, name: siteId === "root" ? "Root" : "First child" }] },
      extensions: { plugins: [{ plugin_id: "justflows.seo", version: "1.0.0" }], themes: [] },
      files: [],
    }));

    const artifact = await buildNetworkBackup("root", "2026-11-18T12:00:00.000Z", "mysql", "0.4.4");

    expect(artifact.filename).toBe("justflows-network-root-2026-11-18.jfbackup");
    const { manifest } = openNetworkBackup(artifact.archive);
    expect(manifest.sites.map((site) => [site.siteId, site.root, site.hostnames])).toEqual([
      ["root", true, [{ hostname: "example.test", primary: true }]],
      [
        "child-1",
        false,
        [
          { hostname: "child.example.test", primary: true },
          { hostname: "alias.example.test", primary: false },
        ],
      ],
    ]);
    expect(manifest.extensions.plugins).toEqual([
      { id: "justflows.seo", version: "1.0.0", sites: ["root", "child-1"] },
    ]);
  });
});
