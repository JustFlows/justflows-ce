// SPDX-License-Identifier: MIT

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertExportOrigin } from "../../../src/lib/static-export/config.js";
import { exportFetch } from "../../../src/lib/static-export/export-fetch.js";
import { runWithTenant, type TenantRequestContext } from "../../../src/lib/tenancy/context.js";

const tenant: TenantRequestContext = {
  tenantId: "tenant-b",
  siteId: "site-b",
  hostname: "b.example.com",
  userMode: "isolated",
  databaseMode: "current",
  rootSite: false,
  activePluginIds: new Set(),
};

afterEach(() => vi.unstubAllEnvs());

describe("static export origins for a customer site", () => {
  it("refuses other loopback services and custom ports on its own hostname", () => {
    vi.stubEnv("PORT", "3000");
    runWithTenant(tenant, () => {
      expect(() => assertExportOrigin("http://127.0.0.1:6379")).toThrow();
      expect(() => assertExportOrigin("http://localhost:8080")).toThrow();
      expect(() => assertExportOrigin("http://b.example.com:9200")).toThrow();
      expect(() => assertExportOrigin("http://10.0.0.5")).toThrow();
      expect(assertExportOrigin("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
      expect(assertExportOrigin("https://b.example.com")).toBe("https://b.example.com");
    });
  });

  it("never fetches another host", async () => {
    await runWithTenant(tenant, async () => {
      await expect(exportFetch("http://internal.example.net/")).rejects.toThrow("only fetches this site");
    });
  });

  it("dials its own hostname on loopback instead of trusting its DNS", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const server = createServer((req, res) => res.end(`host=${req.headers.host}`));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const body = await runWithTenant(tenant, async () =>
        (await exportFetch(`http://b.example.com:${port}/`)).text(),
      );
      expect(body).toBe(`host=b.example.com:${port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
