// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

const sites = vi.hoisted(() => ({
  list: [] as Array<{ id: string; active: string[]; db: string }>,
}));
const current = vi.hoisted(() => ({ db: "control" }));

vi.mock("../../../src/lib/tenancy/connections.js", () => ({
  eachActiveSite: async (fn: (siteId: string) => Promise<void>, options: { siteId?: string } = {}) => {
    for (const site of sites.list) {
      if (options.siteId && site.id !== options.siteId) continue;
      current.db = site.db;
      try {
        await fn(site.id);
      } catch {
        // eachActiveSite logs and moves on
      }
      current.db = "control";
    }
  },
}));
vi.mock("../../../src/lib/tenancy/registry.js", () => ({ installationRootSiteId: async () => "site-a" }));
vi.mock("../../../src/lib/database/db.js", () => ({
  getDb: async () => ({
    query: async (_sql: string, params: unknown[]) => {
      const site = sites.list.find((item) => item.id === params[0] && item.db === current.db);
      return (site?.active ?? []).map((plugin_id) => ({ plugin_id }));
    },
  }),
  getControlDb: async () => ({
    query: async () => [{ tenant_id: "tenant", user_mode: "isolated", database_mode: "current" }],
  }),
}));

type FakeRow = { id: string; jobName: string; siteId: string | null; payload: unknown; attempts: number; runAt: Date };
const fakeQueue = vi.hoisted(() => ({
  available: true,
  failInsert: false,
  handlers: new Map<string, { maxAttempts: number; run: (row: unknown) => Promise<{ success: boolean; message?: string }> }>(),
  enqueued: [] as Array<{ name: string; options: { delayMs?: number; payload?: unknown; siteId?: string | null } }>,
}));
vi.mock("../../../src/lib/jobs/job-queue.js", () => ({
  DurableJobQueue: class {
    register(name: string, handler: { maxAttempts: number; run: (row: unknown) => Promise<{ success: boolean }> }) {
      fakeQueue.handlers.set(name, handler);
    }
    has(name: string) {
      return fakeQueue.handlers.has(name);
    }
    unregisterPrefix() {}
    start() {}
    async isAvailable() {
      return fakeQueue.available;
    }
    async enqueue(name: string, options: { delayMs?: number; payload?: unknown; siteId?: string | null }) {
      if (fakeQueue.failInsert) throw new Error("insert failed");
      fakeQueue.enqueued.push({ name, options });
      return "row-1";
    }
  },
}));

const { createPluginJobsApi, getPluginJobScheduler, runPerSite } = await import("../../../src/lib/plugins/plugin-jobs.js");
const { getTenantContext, runWithTenant } = await import("../../../src/lib/tenancy/context.js");

describe("per-site plugin jobs", () => {
  beforeEach(() => {
    sites.list = [
      { id: "site-a", active: ["justflows.shop"], db: "control" },
      { id: "site-b", active: ["other.plugin"], db: "control" },
      { id: "site-c", active: ["justflows.shop"], db: "separate-c" },
    ];
  });

  it("runs once per site where the plugin is active, inside that site's context", async () => {
    const seen: Array<{ siteId: string; context: string | undefined; db: string; root: boolean | undefined }> = [];
    const result = await runPerSite("justflows.shop", async (siteId) => {
      const context = getTenantContext();
      seen.push({ siteId, context: context?.siteId, db: current.db, root: context?.rootSite });
      return { success: true };
    });
    expect(result).toEqual({ success: true });
    expect(seen).toEqual([
      { siteId: "site-a", context: "site-a", db: "control", root: true },
      { siteId: "site-c", context: "site-c", db: "separate-c", root: false },
    ]);
  });

  it("keeps going after one site fails and reports it", async () => {
    const ran: string[] = [];
    const result = await runPerSite("justflows.shop", async (siteId) => {
      ran.push(siteId);
      if (siteId === "site-a") throw new Error("boom");
      return { success: true };
    });
    expect(ran).toEqual(["site-a", "site-c"]);
    expect(result).toEqual({ success: false, message: "site-a: boom" });
  });
});

describe("durable plugin job runs", () => {
  beforeEach(() => {
    sites.list = [
      { id: "site-a", active: ["test.durable"], db: "control" },
      { id: "site-c", active: ["test.durable"], db: "separate-c" },
    ];
    fakeQueue.available = true;
    fakeQueue.failInsert = false;
    fakeQueue.enqueued = [];
  });

  const tenant = (siteId: string) => ({
    tenantId: "tenant", siteId, hostname: "", userMode: "isolated" as const, databaseMode: "current" as const,
    rootSite: false, activePluginIds: new Set(["justflows.shop"]),
  });

  it("runs a per-site job only on the site that enqueued it", async () => {
    const jobs = createPluginJobsApi("test.durable");
    const ran: string[] = [];
    jobs.register({
      name: "task",
      perSite: true,
      maxAttempts: 2,
      handler: async (job) => {
        ran.push(`${job.siteId}:${JSON.stringify(job.payload)}`);
        return { success: true };
      },
    });
    await runWithTenant(tenant("site-c"), () => jobs.enqueue("task", { payload: { n: 1 }, delayMs: 50 }));
    expect(fakeQueue.enqueued).toEqual([{ name: "test.durable:task", options: { delayMs: 50, payload: { n: 1 }, siteId: "site-c" } }]);

    const handler = fakeQueue.handlers.get("test.durable:task")!;
    expect(handler.maxAttempts).toBe(2);
    const row: FakeRow = { id: "row-1", jobName: "test.durable:task", siteId: "site-c", payload: { n: 1 }, attempts: 1, runAt: new Date() };
    expect(await handler.run(row)).toEqual({ success: true });
    expect(ran).toEqual(['site-c:{"n":1}']);

    // Enqueued outside a site: every site, as before.
    ran.length = 0;
    await handler.run({ ...row, siteId: null });
    expect(ran).toEqual(['site-a:{"n":1}', 'site-c:{"n":1}']);
  });

  it("does not record a site for a job that is not per-site", async () => {
    const jobs = createPluginJobsApi("test.global");
    jobs.register({ name: "sweep", handler: async () => ({ success: true }) });
    await runWithTenant(tenant("site-a"), () => jobs.enqueue("sweep"));
    expect(fakeQueue.enqueued[0]?.options.siteId).toBeNull();
    expect(fakeQueue.handlers.get("test.global:sweep")?.maxAttempts).toBe(3);
  });

  it("falls back to the in-memory scheduler without the table or when the row cannot be stored", async () => {
    const jobs = createPluginJobsApi("test.fallback");
    jobs.register({ name: "later", handler: async () => ({ success: true }) });
    const memory = vi.spyOn(getPluginJobScheduler(), "enqueue");
    fakeQueue.available = false;
    await jobs.enqueue("later", { payload: 1 });
    fakeQueue.available = true;
    fakeQueue.failInsert = true;
    await expect(jobs.enqueue("later", { payload: 2 })).resolves.toBeUndefined();
    expect(memory.mock.calls.map((call) => call[2])).toEqual([1, 2]);
    expect(fakeQueue.enqueued).toEqual([]);
    expect(() => jobs.enqueue("missing")).toThrow(/not found/);
  });
});

