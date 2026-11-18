// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPortableBackup } from "../../../src/lib/backup/portable-archive.js";
import { createBackupContainer, openBackupContainer } from "../../../src/lib/backup/backup-container.js";

const state = vi.hoisted(() => ({
  calls: [] as string[],
  subsites: [] as Array<{ id: string; name: string }>,
  taken: [] as string[],
  multisite: true,
  failRestore: null as string | null,
  onRestore: null as null | ((siteId: string) => void),
  next: 0,
}));

const control = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("SELECT tenant_id FROM sites")) return [{ tenant_id: "tenant-1" }];
    if (sql.startsWith("SELECT hostname, site_id FROM site_domains")) {
      return [
        ...state.taken.filter((host) => params.includes(host)).map((hostname) => ({ hostname, site_id: "someone-else" })),
        ...(params.includes("root.example.test") ? [{ hostname: "root.example.test", site_id: "target-root" }] : []),
      ];
    }
    if (sql.includes("FROM tenants t JOIN sites")) return [{ id: "tenant-1", name: "Before", user_mode: "isolated" }];
    if (sql.startsWith("SELECT status FROM sites")) return [{ status: "provisioning" }];
    return [];
  }),
  run: vi.fn(async (sql: string, params: unknown[] = []) => {
    state.calls.push(`control:${sql.split(" ").slice(0, 3).join(" ")}:${String(params.at(-1))}`);
  }),
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(control)),
  execute: vi.fn(async () => 1),
}));

vi.mock("../../../src/lib/database/db.js", () => ({
  getControlDb: async () => control,
  getDb: async () => ({
    query: async (sql: string) => (sql.includes("FROM users WHERE id") ? [{ email: "op@example.test" }] : sql.includes("LOWER(email)") ? [{ id: "copied-admin" }] : []),
    run: async (sql: string, params: unknown[] = []) => {
      state.calls.push(`site:${sql.split(" ").slice(0, 3).join(" ")}:${String(params.at(-1))}`);
    },
  }),
}));
vi.mock("../../../src/lib/media/upload-store.js", () => ({ getUploadStore: () => ({ deletePrefix: vi.fn(async () => undefined) }) }));
vi.mock("../../../src/lib/tenancy/multisite.js", () => ({ multisiteEnabled: () => state.multisite }));
vi.mock("../../../src/lib/tenancy/saas-settings.js", () => ({ platformBaseDomain: async () => "example.test" }));
vi.mock("../../../src/lib/backup/site-export.js", () => ({
  exportSiteData: async (_db: unknown, siteId: string) => {
    state.calls.push(`snapshot:${siteId}`);
    return { data: { site: { id: siteId, name: "Root" }, tables: {}, quotaLimits: [], pluginTables: [], packages: [], files: [], privateFiles: [], themeFiles: [], database: null, undecryptableSecrets: 0, extensions: { plugins: [], themes: [] } }, packages: [], hostnames: [] };
  },
}));
vi.mock("../../../src/lib/backup/site-restore.js", () => ({
  restoreSiteBackup: vi.fn(async (input: { targetSiteId: string; rollback?: boolean; envelope: { source: { siteId: string } } }) => {
    state.onRestore?.(input.targetSiteId);
    if (input.rollback) {
      state.calls.push(`putback:${input.targetSiteId}`);
      return { activatedPlugins: [] };
    }
    if (state.failRestore === input.targetSiteId) throw new Error("restore failed");
    state.calls.push(`restore:${input.envelope.source.siteId}->${input.targetSiteId}`);
    return { activatedPlugins: [] };
  }),
  stopPluginsAfterRollback: vi.fn(async () => undefined),
}));
vi.mock("../../../src/lib/backup/workspace-backup.js", () => ({
  withBackupSiteDatabase: (_siteId: string, fn: () => Promise<unknown>) => fn(),
  workspaceSubsites: async () => state.subsites,
}));
vi.mock("../../../src/lib/tenancy/provision.js", () => ({
  probeSeparateDatabase: async () => ({ ok: true }),
  createAdditionalSite: vi.fn(async (input: { name: string; hostname: string; initialStatus?: string }) => {
    const siteId = `new-${++state.next}`;
    state.calls.push(`create:${input.name}:${input.hostname}:${input.initialStatus}`);
    return { ok: true, tenantId: "tenant-1", siteId, hostname: input.hostname };
  }),
}));

const { restoreNetwork } = await import("../../../src/lib/backup/restore-backup.js");
const { createAdditionalSite } = await import("../../../src/lib/tenancy/provision.js");

function site(siteId: string): Buffer {
  return createPortableBackup({
    createdAt: "2026-11-18T10:00:00.000Z",
    source: { siteId, siteName: siteId, databaseDriver: "postgres" },
    data: { site: { id: siteId }, tables: {}, quotaLimits: [], pluginTables: [], packages: [], files: [], privateFiles: [], themeFiles: [], database: null, undecryptableSecrets: 0, extensions: { plugins: [], themes: [] } },
  });
}

function reader() {
  return openBackupContainer(
    createBackupContainer({
      kind: "network",
      createdAt: "2026-11-18T10:00:00.000Z",
      databaseDriver: "postgres",
      installation: { tenant: { name: "Restored", slug: "primary", userMode: "isolated" }, platformSettings: [], platformOperators: [] },
      sites: [
        { siteId: "src-root", siteName: "Root", root: true, hostnames: [], archive: site("src-root") },
        { siteId: "src-a", siteName: "Alpha", root: false, hostnames: [], archive: site("src-a") },
        { siteId: "src-b", siteName: "Beta", root: false, hostnames: [], archive: site("src-b") },
      ],
      packages: [],
    }),
  );
}

const plan = {
  hostnames: {
    "src-a": [{ hostname: "alpha.example.test", primary: true }, { hostname: "alpha.custom.test" }],
    "src-b": [{ hostname: "beta.example.test", primary: true }],
  },
};

function run(extra: { signal?: AbortSignal; plan?: typeof plan } = {}) {
  return restoreNetwork({ rootSiteId: "target-root", actorId: "operator-1", reader: reader(), plan: extra.plan ?? plan, signal: extra.signal });
}

describe("network restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(state, { calls: [], subsites: [], taken: [], multisite: true, failRestore: null, onRestore: null, next: 0 });
  });

  it("restores the root first, creates subsites offline, and activates them last", async () => {
    const result = await run();
    expect(result.sites.map((item) => [item.sourceSiteId, item.siteId])).toEqual([["src-root", "target-root"], ["src-a", "new-1"], ["src-b", "new-2"]]);
    const order = state.calls.filter((call) => /^(snapshot|restore|create|control:UPDATE sites)/.test(call));
    expect(order).toEqual([
      "snapshot:target-root",
      "restore:src-root->target-root",
      "create:Alpha:alpha.example.test:provisioning",
      "restore:src-a->new-1",
      "create:Beta:beta.example.test:provisioning",
      "restore:src-b->new-2",
      "control:UPDATE sites SET:new-1",
      "control:UPDATE sites SET:new-2",
    ]);
    const aliases = control.run.mock.calls.filter(([sql]) => String(sql).startsWith("INSERT INTO site_domains"));
    expect(aliases.map(([, params]) => [params?.[2], params?.[7]])).toEqual([["alpha.custom.test", "pending"]]);
  });

  it("skips an address the root site already has instead of refusing the restore", async () => {
    await run({ plan: { ...plan, hostnames: { ...plan.hostnames, "src-root": [{ hostname: "root.example.test" }] } } as typeof plan });
    const added = control.run.mock.calls.filter(([sql]) => String(sql).startsWith("INSERT INTO site_domains")).map(([, params]) => params?.[2]);
    expect(added).not.toContain("root.example.test");
  });

  it("refuses a target with subsites, multisite off, or a taken address before changing anything", async () => {
    state.subsites = [{ id: "existing", name: "Existing" }];
    await expect(run()).rejects.toThrow(/clean installation/);
    state.subsites = [];
    state.multisite = false;
    await expect(run()).rejects.toThrow(/JF_MULTISITE/);
    state.multisite = true;
    state.taken = ["beta.example.test"];
    await expect(run()).rejects.toThrow(/already in use/);
    expect(createAdditionalSite).not.toHaveBeenCalled();
    expect(state.calls.some((call) => call.startsWith("restore:"))).toBe(false);
  });

  it("removes new subsites and puts the root back when a subsite fails", async () => {
    state.failRestore = "new-2";
    await expect(run()).rejects.toThrow(/restore failed\. The new subsites were removed and the root site was put back/);
    expect(state.calls).toContain("control:DELETE FROM sites:new-1");
    expect(state.calls).toContain("control:DELETE FROM sites:new-2");
    expect(state.calls).toContain("putback:target-root");
    expect(state.calls.some((call) => call === "control:UPDATE tenants SET:tenant-1")).toBe(true);
    expect(control.run.mock.calls.some(([sql]) => String(sql).includes("status = 'active'"))).toBe(false);
  });

  it("rolls everything back when cancelled", async () => {
    const controller = new AbortController();
    state.onRestore = (siteId) => {
      if (siteId === "new-1") controller.abort();
    };
    await expect(run({ signal: controller.signal })).rejects.toThrow(/Restore cancelled/);
    expect(state.calls).toContain("control:DELETE FROM sites:new-1");
    expect(state.calls).toContain("putback:target-root");
    expect(state.calls.some((call) => call.startsWith("create:Beta"))).toBe(false);
  });
});
