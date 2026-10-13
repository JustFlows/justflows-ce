// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runAsDelegate, type DelegateKind } from "../../../../src/lib/security/delegated-call.js";
import { runWithTenant } from "../../../../src/lib/tenancy/context.js";

const state = vi.hoisted(() => ({ kind: "mcp" as DelegateKind, database: vi.fn(), operator: vi.fn(async () => true) }));
vi.mock("../../../../src/lib/database/db.js", () => ({ getDb: state.database, getControlDb: state.database }));
vi.mock("../../../../src/lib/auth/api-keys.js", () => ({ keyCan: async () => true }));
vi.mock("../../../../src/lib/tenancy/access.js", async (original) => ({
  ...await original<typeof import("../../../../src/lib/tenancy/access.js")>(),
  isPlatformOperator: state.operator,
}));

const { default: tenants, siteQuotaRoutes } = await import("../../../../src/routes/manage-api/tenants.js");
const { default: system } = await import("../../../../src/routes/manage-api/system.js");
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.apiKeyOwner = { siteId: "root", userId: "operator", role: "administrator" };
    req.apiKey = {} as NonNullable<typeof req.apiKey>;
    runWithTenant({ siteId: "root", tenantId: "t1", hostname: "root.test", userMode: "isolated", databaseMode: "current", rootSite: true, activePluginIds: new Set() }, () =>
      runAsDelegate({ kind: state.kind, client: "test" }, next));
  });
  app.use("/tenants", tenants);
  app.use("/sites", siteQuotaRoutes);
  app.use(system);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { state.database.mockClear(); state.operator.mockClear(); });

describe("delegated installation access", () => {
  it.each(["mcp", "assistant", "api-key", "oauth"] as const)("denies global APIs for %s even on the root site with an operator owner", async (kind) => {
    state.kind = kind;
    for (const path of ["/tenants", "/tenants/other/quotas", "/sites/other/quotas", "/health", "/diagnostics", "/cache/stats"]) {
      const response = await fetch(`${base}${path}`);
      expect(response.status, path).toBe(403);
    }
    expect((await fetch(`${base}/cache/clear`, { method: "POST" })).status).toBe(403);
    expect(state.database).not.toHaveBeenCalled();
    expect(state.operator).not.toHaveBeenCalled();
  });
});
