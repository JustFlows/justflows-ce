// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { finalizeAdminMenu, stampSetupPaths } from "../admin-menu.js";

describe("finalizeAdminMenu", () => {
  it("resolves plugin-relative paths and drops the rest", () => {
    const items = finalizeAdminMenu([
      { pluginId: "acme.seo", id: "reports", label: "Reports", path: "reports", icon: "📊", domain: "extensions" },
      { pluginId: "acme.seo", id: "dup", label: "Dup", path: "reports" },
      { id: "no-owner", label: "Nope", path: "nope" },
      { pluginId: "acme.seo", id: "escape", label: "Escape", path: "../secret" },
      { pluginId: "acme.seo", id: "absolute", label: "Absolute", path: "/admin/other" },
    ]);
    expect(items).toEqual([
      expect.objectContaining({
        pluginId: "acme.seo",
        path: "/admin/plugins/acme.seo/reports",
        label: "Reports",
      }),
    ]);
  });

  it("treats an omitted path as the plugin's namespace root", () => {
    const items = finalizeAdminMenu([
      {
        pluginId: "justflows.shop",
        id: "shop",
        label: "Shop",
        icon: "🛍",
        domain: "commerce",
      },
    ]);
    expect(items).toEqual([
      expect.objectContaining({
        pluginId: "justflows.shop",
        path: "/admin/plugins/justflows.shop",
        domain: "commerce",
      }),
    ]);
  });

  it("keeps setupPath so nested pages can skip the wizard", () => {
    const items = finalizeAdminMenu([
      {
        pluginId: "justflows.shop",
        id: "products",
        label: "Products",
        path: "products",
        domain: "commerce",
        setupPath: "",
      },
    ]);
    expect(items).toEqual([
      expect.objectContaining({
        path: "/admin/plugins/justflows.shop/products",
        setupPath: "/admin/plugins/justflows.shop",
      }),
    ]);
  });

  it("keeps a valid contentType and drops an invalid one", () => {
    const items = finalizeAdminMenu([
      {
        pluginId: "justflows.shop",
        id: "products",
        label: "Products",
        path: "products",
        domain: "commerce",
        contentType: "product",
      },
      {
        pluginId: "acme.seo",
        id: "reports",
        label: "Reports",
        path: "reports",
        contentType: "Not Valid!",
      },
    ]);
    expect(items).toEqual([
      expect.objectContaining({
        path: "/admin/plugins/justflows.shop/products",
        contentType: "product",
      }),
      expect.objectContaining({
        path: "/admin/plugins/acme.seo/reports",
        contentType: undefined,
      }),
    ]);
  });
});

describe("stampSetupPaths", () => {
  it("fills setupPath from the plugin manifest when the item omitted it", () => {
    const stamped = stampSetupPaths(
      [
        {
          pluginId: "justflows.shop",
          id: "products",
          label: "Products",
          path: "/admin/plugins/justflows.shop/products",
          icon: "📦",
          domain: "commerce",
        },
      ],
      new Map([["justflows.shop", "/admin/plugins/justflows.shop"]]),
    );
    expect(stamped[0]?.setupPath).toBe("/admin/plugins/justflows.shop");
  });
});
