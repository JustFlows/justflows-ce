// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { PluginManifestSchema, SENSITIVE_PERMISSIONS } from "./plugin.js";

const base = {
  id: "acme.widget",
  name: "Acme Widget",
  version: "1.0.0",
  license: "GPL-2.0-or-later",
};

describe("PluginManifestSchema — mail sending", () => {
  it("accepts mail:send and treats it as sensitive", () => {
    const parsed = PluginManifestSchema.parse({ ...base, permissions: ["mail:send"] });
    expect(parsed.permissions).toContain("mail:send");
    expect(SENSITIVE_PERMISSIONS).toContain("mail:send");
  });
});

describe("PluginManifestSchema — assets", () => {
  it("accepts a scripts-only assets block and defaults dir handling to the host", () => {
    const parsed = PluginManifestSchema.parse({
      ...base,
      assets: { scripts: ["widget.js"] },
    });
    expect(parsed.assets?.scripts).toEqual(["widget.js"]);
    expect(parsed.assets?.dir).toBeUndefined();
  });

  it("accepts a nested dir and .css/.mjs entries", () => {
    const parsed = PluginManifestSchema.parse({
      ...base,
      assets: { dir: "dist/public", scripts: ["a/b.mjs"], styles: ["w.css"] },
    });
    expect(parsed.assets?.dir).toBe("dist/public");
  });

  it("rejects traversal in dir or asset paths", () => {
    expect(() => PluginManifestSchema.parse({ ...base, assets: { dir: "../etc" } })).toThrow();
    expect(() =>
      PluginManifestSchema.parse({ ...base, assets: { scripts: ["../x.js"] } }),
    ).toThrow();
  });

  it("rejects non-js/css asset extensions", () => {
    expect(() =>
      PluginManifestSchema.parse({ ...base, assets: { scripts: ["payload.sh"] } }),
    ).toThrow();
  });

  it("leaves manifests without an assets block untouched", () => {
    const parsed = PluginManifestSchema.parse(base);
    expect(parsed.assets).toBeUndefined();
  });
});

describe("PluginManifestSchema — adminApp", () => {
  const withPerm = { ...base, permissions: ["admin:extend"] };

  it("accepts routes with a default dir and an optional title", () => {
    const parsed = PluginManifestSchema.parse({
      ...withPerm,
      adminApp: {
        routes: [
          { path: "/admin/forms", entry: "index.html", title: "Forms" },
          { path: "/admin/forms/submissions", entry: "index.html" },
        ],
      },
    });
    expect(parsed.adminApp?.dir).toBeUndefined();
    expect(parsed.adminApp?.routes).toHaveLength(2);
  });

  it("accepts a nested build dir", () => {
    const parsed = PluginManifestSchema.parse({
      ...withPerm,
      adminApp: { dir: "dist/admin", routes: [{ path: "/admin/x", entry: "app/index.html" }] },
    });
    expect(parsed.adminApp?.dir).toBe("dist/admin");
  });

  it("requires the admin:extend permission", () => {
    const result = PluginManifestSchema.safeParse({
      ...base,
      adminApp: { routes: [{ path: "/admin/x", entry: "index.html" }] },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === "adminApp")).toBe(true);
  });

  it("rejects a non-/admin path, a non-html entry, and traversal", () => {
    expect(() =>
      PluginManifestSchema.parse({
        ...withPerm,
        adminApp: { routes: [{ path: "/wp-admin/x", entry: "index.html" }] },
      }),
    ).toThrow();
    expect(() =>
      PluginManifestSchema.parse({
        ...withPerm,
        adminApp: { routes: [{ path: "/admin/x", entry: "app.js" }] },
      }),
    ).toThrow();
    expect(() =>
      PluginManifestSchema.parse({
        ...withPerm,
        adminApp: { routes: [{ path: "/admin/x", entry: "../evil.html" }] },
      }),
    ).toThrow();
  });

  it("requires at least one route", () => {
    expect(() => PluginManifestSchema.parse({ ...withPerm, adminApp: { routes: [] } })).toThrow();
  });

  it("leaves manifests without an adminApp block untouched", () => {
    expect(PluginManifestSchema.parse(base).adminApp).toBeUndefined();
  });
});
