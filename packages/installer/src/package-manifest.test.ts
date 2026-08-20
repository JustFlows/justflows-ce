import { describe, expect, it } from "vitest";
import { PackageManifestSchema } from "./package-manifest.js";

const base = {
  schemaVersion: 1 as const,
  type: "plugin" as const,
  id: "test.plugin",
  name: "Test",
  version: "1.0.0",
  publisher: "Test",
  license: "GPL-2.0-or-later",
};

const menuItem = {
  id: "reports",
  label: "Reports",
  labelKey: "nav.reports",
  path: "/admin/reports",
  icon: "📊",
  domain: "extensions" as const,
};

describe("PackageManifestSchema adminMenu", () => {
  it("keeps declared admin pages so they survive install", () => {
    const parsed = PackageManifestSchema.parse({
      ...base,
      permissions: ["admin:extend"],
      adminMenu: [menuItem],
    });

    expect(parsed.adminMenu).toEqual([menuItem]);
  });

  it("rejects admin pages without the admin:extend permission", () => {
    const result = PackageManifestSchema.safeParse({ ...base, adminMenu: [menuItem] });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === "adminMenu")).toBe(true);
  });

  it("rejects a menu path outside /admin/", () => {
    const result = PackageManifestSchema.safeParse({
      ...base,
      permissions: ["admin:extend"],
      adminMenu: [{ ...menuItem, path: "/wp-admin/reports" }],
    });

    expect(result.success).toBe(false);
  });
});
