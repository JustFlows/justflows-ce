// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ plugin_id: string; status: string; manifest: Record<string, unknown> }>,
  routes: [] as Array<{ pluginId: string; path: string; entryUrl: string; title?: string }>,
}));

vi.mock("../../../src/lib/database/db.js", () => ({
  getDb: async () => ({ query: async () => mocks.rows }),
}));
// The shared module stays loaded for the main site, so its admin.menu filter
// keeps adding Shop items on every site.
vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({
  ensurePluginRuntime: async () => {},
  getRuntimeHooks: () => ({
    applyFilter: async (_name: string, items: unknown[]) => [
      ...items,
      { pluginId: "justflows.shop", id: "products", label: "Products", path: "products", domain: "commerce" },
    ],
  }),
}));
vi.mock("../../../src/lib/plugins/plugin-admin-app.js", () => ({
  getPluginAdminRoutes: async () => mocks.routes,
}));

const { listPluginAdminMenu } = await import("../../../src/lib/admin/admin-menu.js");

beforeEach(() => {
  mocks.rows = [];
  mocks.routes = [
    {
      pluginId: "justflows.shop",
      path: "/admin/plugins/justflows.shop/products/import",
      entryUrl: "/ext/justflows.shop/admin/products.html",
      title: "Import products",
    },
    {
      pluginId: "justflows.shop",
      path: "/admin/plugins/justflows.shop/tax",
      entryUrl: "/ext/justflows.shop/admin/tax.html",
      title: "Tax",
    },
  ];
});

describe("listPluginAdminMenu", () => {
  it("shows no screens for a plugin this site has turned off", async () => {
    mocks.rows = [
      {
        plugin_id: "justflows.shop",
        status: "inactive",
        manifest: { adminMenu: [], permissions: ["admin:extend"] },
      },
    ];
    expect(await listPluginAdminMenu("site-sub")).toEqual([]);
  });

  it("keeps the screens while the plugin is active on this site", async () => {
    mocks.rows = [
      {
        plugin_id: "justflows.shop",
        status: "active",
        manifest: { adminMenu: [], permissions: ["admin:extend"] },
      },
    ];
    const paths = (await listPluginAdminMenu("site-sub")).map((item) => item.path);
    expect(paths).toEqual([
      "/admin/plugins/justflows.shop/products",
      "/admin/plugins/justflows.shop/products/import",
      "/admin/plugins/justflows.shop/tax",
    ]);
  });
});
