// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

const sites = vi.hoisted(() => ({
  list: [] as Array<{ id: string; active: string[]; db: string }>,
}));
const current = vi.hoisted(() => ({ db: "control" }));

vi.mock("../../../src/lib/tenancy/connections.js", () => ({
  eachActiveSite: async (fn: (siteId: string) => Promise<void>) => {
    for (const site of sites.list) {
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

const { runPerSite } = await import("../../../src/lib/plugins/plugin-jobs.js");
const { getTenantContext } = await import("../../../src/lib/tenancy/context.js");

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
