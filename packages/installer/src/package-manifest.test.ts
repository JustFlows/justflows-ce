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

describe("PackageManifestSchema version", () => {
  it("accepts plain and prerelease semver", () => {
    for (const version of ["1.0.0", "0.1.3-rc", "1.2.3-beta.1", "10.20.30+build.5"]) {
      expect(PackageManifestSchema.safeParse({ ...base, version }).success).toBe(true);
    }
  });

  // The pattern used to be anchored only at the start, so everything after the
  // patch number was unconstrained — and the installer joins this value into the
  // destination path.
  it("rejects a version carrying path traversal", () => {
    const result = PackageManifestSchema.safeParse({
      ...base,
      version: "1.0.0/../../../../../../tmp/pwned",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === "version")).toBe(true);
  });

  it("rejects trailing junk after the patch number", () => {
    for (const version of ["1.0.0/etc", "1.0.0\\..\\..", "1.0.0 ", "1.0.0../x"]) {
      expect(PackageManifestSchema.safeParse({ ...base, version }).success).toBe(false);
    }
  });
});
