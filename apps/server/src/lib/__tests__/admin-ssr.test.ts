// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { adminPrefetchPaths, serializeAdminSsrData } from "../admin-ssr.js";

describe("admin SSR", () => {
  it("prefetches shared and route data for the content screen", () => {
    const paths = adminPrefetchPaths("/admin/content");
    expect(paths).toContain("/api/site/identity");
    expect(paths).toContain("/api/updates");
    expect(paths).toContain("/api/plugins/admin-menu");
    expect(paths).toContain("/api/i18n/en");
    expect(paths).toContain("/api/i18n/nl");
    expect(paths).toContain("/api/content");
    expect(paths).toContain("/api/settings");
    expect(paths).toContain("/api/content-types");
  });

  it("prefetches dynamic editor and plugin settings paths", () => {
    expect(adminPrefetchPaths("/admin/content/abc")).toContain("/api/content/abc");
    expect(adminPrefetchPaths("/admin/plugins/demo/settings")).toContain("/api/plugins/demo/settings");
    expect(adminPrefetchPaths("/admin/themes/customize?preview=1")).toContain("/api/site/identity?preview=1");
  });

  it("cannot break out of the embedded JSON script", () => {
    const serialized = serializeAdminSsrData({ value: "</script><script>alert(1)</script>\u2028" });
    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain("\u2028");
    expect(JSON.parse(serialized)).toEqual({ value: "</script><script>alert(1)</script>\u2028" });
  });
});
