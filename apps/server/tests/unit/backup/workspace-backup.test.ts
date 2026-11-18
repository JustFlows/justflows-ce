// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "../../../src/lib/database/db.js";

const getControlDb = vi.fn();
const getDb = vi.fn();
const exportSiteData = vi.fn();
const runWithDatabase = vi.fn((_db: DbClient, fn: () => Promise<unknown>) => fn());

vi.mock("../../../src/lib/database/db.js", () => ({ getControlDb, getDb, runWithDatabase }));
vi.mock("../../../src/lib/backup/site-export.js", () => ({ exportSiteData }));
vi.mock("../../../src/lib/tenancy/choice.js", () => ({ effectiveDatabaseMode: () => "current" }));
vi.mock("../../../src/lib/tenancy/connections.js", () => ({ separateDatabaseForSite: vi.fn(), borrowSeparateDatabase: vi.fn() }));
vi.mock("../../../src/lib/tenancy/registry.js", () => ({ isInstallationRootSite: async (id: string) => id === "root" }));

const { buildNetworkBackup, buildSubsiteBackups } = await import("../../../src/lib/backup/workspace-backup.js");
const { openBackup } = await import("../../../src/lib/backup/archive-crypto.js");
const { openBackupContainer } = await import("../../../src/lib/backup/backup-container.js");

const passphrase = "network passphrase 1";
const options = { passphrase, createdAt: "2026-11-18T12:00:00.000Z", databaseDriver: "mysql" as const, coreVersion: "0.4.4" };

function controlQuery() {
  return vi.fn(async <T>(sql: string, params?: unknown[]) => {
    if (sql.startsWith("SELECT tenant_id")) return [{ tenant_id: "tenant-root" }] as T[];
    if (sql.includes("JOIN tenants t ON t.id = s.tenant_id WHERE s.id")) return [{ tenant_id: "tenant-root", database_choice: "current", database_mode: "current" }] as T[];
    if (sql.includes("information_schema")) return [{ name: "setting_key", type: "character varying", column_type: "varchar" }, { name: "setting_value", type: "jsonb", column_type: "jsonb" }] as T[];
    if (sql.includes("FROM platform_settings")) {
      expect(sql).toContain('x."setting_value"');
      return [{ setting_key: "signup", setting_value: "on" }] as T[];
    }
    if (sql.includes("FROM platform_operators")) return [{ user_id: "user-1" }] as T[];
    if (sql.includes("FROM tenants t JOIN sites")) return [{ name: "Primary", slug: "primary", user_mode: "isolated" }] as T[];
    expect(sql).toContain("tenant_id = ? AND id <> ?");
    expect(params).toEqual(["tenant-root", "root"]);
    return [{ id: "child-1", name: "First child" }] as T[];
  }) as unknown as DbClient["query"];
}

function exported(siteId: string) {
  return {
    data: {
      site: { id: siteId, name: siteId === "root" ? "Root" : "First child" },
      tables: {},
      quotaLimits: [],
      pluginTables: [],
      packages: [],
      files: [],
      privateFiles: [],
      themeFiles: [],
      database: null,
      undecryptableSecrets: 0,
      extensions: { plugins: [{ plugin_id: "justflows.seo", version: "1.0.0" }], themes: [] },
    },
    packages: [],
    hostnames: [{ hostname: `${siteId}.example.test`, primary: true, kind: "subdomain" }],
  };
}

describe("workspace backups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getControlDb.mockResolvedValue({ query: controlQuery() } as unknown as DbClient);
    getDb.mockResolvedValue({} as DbClient);
    exportSiteData.mockImplementation(async (_db: DbClient, siteId: string) => exported(siteId));
  });

  it("encrypts one network file with every site, its addresses, and the installation settings", async () => {
    const artifact = await buildNetworkBackup("root", options);
    expect(artifact.filename).toBe("justflows-network-root-2026-11-18.jfbackup");
    expect(artifact.archive.includes(Buffer.from("example.test"))).toBe(false);
    const { header, plaintext } = openBackup(artifact.archive, passphrase);
    expect(header.kind).toBe("network");
    const { manifest } = openBackupContainer(plaintext);
    expect(manifest.sites.map((site) => [site.siteId, site.root, site.hostnames[0]?.hostname])).toEqual([
      ["root", true, "root.example.test"],
      ["child-1", false, "child-1.example.test"],
    ]);
    expect(manifest.installation).toEqual({
      tenant: { name: "Primary", slug: "primary", userMode: "isolated" },
      platformSettings: [{ setting_key: "signup", setting_value: "on" }],
      platformOperators: ["user-1"],
    });
    expect(exportSiteData.mock.calls.map((call) => [call[1], call[2].installationRoot])).toEqual([["root", true], ["child-1", false]]);
  });

  it("creates one encrypted file per subsite", async () => {
    const files = await buildSubsiteBackups("root", options);
    expect(files.map((file) => file.filename)).toEqual(["justflows-subsite-first-child-2026-11-18.jfbackup"]);
    expect(openBackup(files[0]!.archive, passphrase).header.kind).toBe("site");
    expect(runWithDatabase).toHaveBeenCalledTimes(1);
  });
});
