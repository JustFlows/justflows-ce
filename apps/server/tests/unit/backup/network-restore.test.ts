// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPortableBackup } from "../../../src/lib/backup/portable-archive.js";
import { createNetworkBackup, openNetworkBackup } from "../../../src/lib/backup/network-archive.js";

const state = vi.hoisted(() => ({
  calls: [] as string[],
  subsites: [] as Array<{ id: string; name: string }>,
  takenHostnames: [] as string[],
  multisite: true,
  failRestoreFor: null as string | null,
  failCreateFor: null as string | null,
  onRestore: null as null | ((siteId: string) => void),
  nextSite: 0,
}));

const control = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("SELECT tenant_id FROM sites")) return [{ tenant_id: "tenant-1" }];
    if (sql.startsWith("SELECT hostname FROM site_domains")) {
      return state.takenHostnames.filter((host) => params.includes(host)).map((hostname) => ({ hostname }));
    }
    if (sql.startsWith("SELECT site_id FROM site_domains")) return [];
    return [];
  }),
  run: vi.fn(async (sql: string, params: unknown[] = []) => {
    state.calls.push(`control:${sql.split(" ").slice(0, 3).join(" ")}:${String(params.at(-1))}`);
  }),
}));

const upload = vi.hoisted(() => ({ deletePrefix: vi.fn(async () => undefined) }));

vi.mock("../../../src/lib/database/db.js", () => ({
  getControlDb: async () => control,
  getDb: async () => ({
    run: async (sql: string, params: unknown[] = []) => {
      state.calls.push(`site:${sql.split(" ").slice(0, 3).join(" ")}:${String(params.at(-1))}`);
    },
  }),
}));
vi.mock("../../../src/lib/media/upload-store.js", () => ({ getUploadStore: () => upload }));
vi.mock("../../../src/lib/tenancy/multisite.js", () => ({ multisiteEnabled: () => state.multisite }));
vi.mock("../../../src/lib/tenancy/provision.js", () => ({
  createAdditionalSite: vi.fn(async (input: { name: string; hostname: string; adminFrom: unknown }) => {
    if (state.failCreateFor === input.name) return { ok: false, status: 409, error: "quota reached" };
    const siteId = `new-${++state.nextSite}`;
    state.calls.push(`create:${input.name}:${input.hostname}`);
    return { ok: true, tenantId: "tenant-1", siteId, hostname: input.hostname };
  }),
}));
vi.mock("../../../src/lib/backup/site-restore.js", () => ({
  restoreSiteBackup: vi.fn(async (_db: unknown, siteId: string, backup: { source: { siteId: string } }) => {
    state.onRestore?.(siteId);
    if (state.failRestoreFor === siteId) throw new Error("restore failed");
    state.calls.push(`restore:${backup.source.siteId}->${siteId}`);
  }),
}));
vi.mock("../../../src/lib/backup/workspace-backup.js", () => ({
  withBackupSiteDatabase: (_siteId: string, fn: () => Promise<unknown>) => fn(),
  workspaceSubsites: async () => state.subsites,
}));

const { restoreNetworkBackup, validateNetworkHostnames } = await import(
  "../../../src/lib/backup/network-restore.js"
);
const { createAdditionalSite } = await import("../../../src/lib/tenancy/provision.js");

function siteArchive(siteId: string): Buffer {
  return createPortableBackup({
    createdAt: "2026-11-18T10:00:00.000Z",
    source: { siteId, siteName: siteId, databaseDriver: "postgres" },
    data: { tables: {}, extensions: { plugins: [], themes: [] }, files: [] },
  });
}

function reader() {
  return openNetworkBackup(
    createNetworkBackup({
      createdAt: "2026-11-18T10:00:00.000Z",
      databaseDriver: "postgres",
      sites: [
        { siteId: "src-root", siteName: "Root", root: true, hostnames: [], archive: siteArchive("src-root") },
        { siteId: "src-a", siteName: "Alpha", root: false, hostnames: [], archive: siteArchive("src-a") },
        { siteId: "src-b", siteName: "Beta", root: false, hostnames: [], archive: siteArchive("src-b") },
      ],
    }),
  );
}

const hostnames = { "src-a": "alpha.example.test", "src-b": "beta.example.test" };

function restore(extra: { signal?: AbortSignal; hostnames?: Record<string, unknown> } = {}) {
  return restoreNetworkBackup({
    rootSiteId: "target-root",
    actorId: "operator-1",
    reader: reader(),
    hostnames: extra.hostnames ?? hostnames,
    signal: extra.signal,
  });
}

describe("network restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(state, {
      calls: [],
      subsites: [],
      takenHostnames: [],
      multisite: true,
      failRestoreFor: null,
      failCreateFor: null,
      onRestore: null,
      nextSite: 0,
    });
  });

  it("recreates subsites inactive, restores the root last, then activates them", async () => {
    const result = await restore();

    expect(result.sites.map((site) => [site.sourceSiteId, site.siteId, site.hostname])).toEqual([
      ["src-root", "target-root", null],
      ["src-a", "new-1", "alpha.example.test"],
      ["src-b", "new-2", "beta.example.test"],
    ]);
    expect(state.calls).toEqual([
      "create:Alpha:alpha.example.test",
      "control:UPDATE sites SET:new-1",
      "restore:src-a->new-1",
      "create:Beta:beta.example.test",
      "control:UPDATE sites SET:new-2",
      "restore:src-b->new-2",
      "restore:src-root->target-root",
      "control:UPDATE sites SET:new-1",
      "control:UPDATE sites SET:new-2",
    ]);
    const statuses = control.run.mock.calls.map(([sql]) => /status = '(\w+)'/.exec(String(sql))?.[1]);
    expect(statuses).toEqual(["provisioning", "provisioning", "active", "active"]);
    expect(vi.mocked(createAdditionalSite).mock.calls[0]?.[0]).toMatchObject({
      tenantId: "tenant-1",
      databaseChoice: "inherit",
      adminFrom: { siteId: "target-root", userId: "operator-1" },
    });
  });

  it("refuses a target that already has subsites before changing anything", async () => {
    state.subsites = [{ id: "existing", name: "Existing" }];
    await expect(restore()).rejects.toThrow(/clean installation/);
    expect(createAdditionalSite).not.toHaveBeenCalled();
    expect(control.run).not.toHaveBeenCalled();
  });

  it("refuses subsites while multisite is off", async () => {
    state.multisite = false;
    await expect(restore()).rejects.toThrow(/JF_MULTISITE/);
    expect(createAdditionalSite).not.toHaveBeenCalled();
  });

  it("refuses missing, duplicate, and already routed hostnames", async () => {
    await expect(restore({ hostnames: { "src-a": "alpha.example.test" } })).rejects.toThrow(
      /valid hostname for Beta/,
    );
    await expect(
      restore({ hostnames: { "src-a": "same.example.test", "src-b": "SAME.example.test" } }),
    ).rejects.toThrow(/more than one site/);
    state.takenHostnames = ["beta.example.test"];
    await expect(restore()).rejects.toThrow(/already in use/);
    expect(createAdditionalSite).not.toHaveBeenCalled();
  });

  it("removes every created subsite when the root restore fails", async () => {
    state.failRestoreFor = "target-root";
    await expect(restore()).rejects.toThrow(/restore failed\. No subsites were kept/);
    expect(state.calls).toContain("control:DELETE FROM sites:new-1");
    expect(state.calls).toContain("control:DELETE FROM sites:new-2");
    expect(upload.deletePrefix).toHaveBeenCalledWith("new-1/");
    expect(upload.deletePrefix).toHaveBeenCalledWith("new-2/");
    expect(control.run.mock.calls.some(([sql]) => String(sql).includes("status = 'active'"))).toBe(
      false,
    );
  });

  it("removes the subsites already created when a later one cannot be created", async () => {
    state.failCreateFor = "Beta";
    await expect(restore()).rejects.toThrow(/Beta: quota reached/);
    expect(state.calls).toContain("control:DELETE FROM sites:new-1");
    expect(state.calls).not.toContain("restore:src-root->target-root");
  });

  it("rolls back when cancelled between sites", async () => {
    const controller = new AbortController();
    state.onRestore = (siteId) => {
      if (siteId === "new-1") controller.abort();
    };
    await expect(restore({ signal: controller.signal })).rejects.toThrow(/Restore cancelled/);
    expect(state.calls).toContain("control:DELETE FROM sites:new-1");
    expect(state.calls.some((call) => call.startsWith("create:Beta"))).toBe(false);
    expect(state.calls).not.toContain("restore:src-root->target-root");
  });

  it("normalizes hostnames for the explicit mapping", async () => {
    const map = await validateNetworkHostnames(reader().manifest.sites, {
      "src-a": " Alpha.Example.TEST ",
      "src-b": "beta.example.test",
    });
    expect([...map.entries()]).toEqual([
      ["src-a", "alpha.example.test"],
      ["src-b", "beta.example.test"],
    ]);
  });
});
