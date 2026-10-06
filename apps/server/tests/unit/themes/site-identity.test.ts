// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest";
import { runWithTenant, type TenantRequestContext } from "../../../src/lib/tenancy/context.js";

const sites = [
  { id: "workspace", name: "Dirks website", description: "The workspace" },
  { id: "subsite", name: "construction-demo", description: "A construction site" },
];

vi.mock("../../../src/lib/database/db.js", () => ({
  getDb: async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      if (/FROM sites/i.test(sql)) {
        const id = params[0];
        if (typeof id === "string") return sites.filter((site) => site.id === id);
        return sites;
      }
      return [];
    },
    run: async () => {},
  }),
}));

const { getSiteIdentity } = await import("../../../src/lib/themes/theme-customize.js");

function tenant(siteId: string): TenantRequestContext {
  return {
    tenantId: "tenant",
    siteId,
    hostname: `${siteId}.example.com`,
    userMode: "isolated",
    databaseMode: "current",
    rootSite: siteId === "workspace",
    activePluginIds: null,
  };
}

describe("getSiteIdentity", () => {
  it("reads the website being served when several sites share the database", async () => {
    const identity = await runWithTenant(tenant("subsite"), () =>
      getSiteIdentity({ identity: { logoUrl: "" } }),
    );
    expect(identity.siteTitle).toBe("construction-demo");
    expect(identity.tagline).toBe("A construction site");
  });

  it("keeps the workspace name on the workspace host", async () => {
    const identity = await runWithTenant(tenant("workspace"), () =>
      getSiteIdentity({ identity: { logoUrl: "" } }),
    );
    expect(identity.siteTitle).toBe("Dirks website");
    expect(identity.tagline).toBe("The workspace");
  });
});
