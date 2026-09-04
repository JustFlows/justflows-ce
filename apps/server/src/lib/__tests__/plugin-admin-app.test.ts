// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { parseAdminAppSpec, safeAdminRel } from "../plugin-admin-app.js";
import { stampAdminAppUrls, type AdminMenuEntry } from "../admin-menu.js";

describe("safeAdminRel", () => {
  it("accepts relative build files with known extensions", () => {
    expect(safeAdminRel("index.html")).toBe("index.html");
    expect(safeAdminRel("assets/app.js")).toBe("assets/app.js");
    expect(safeAdminRel("assets/app-a1b2.css")).toBe("assets/app-a1b2.css");
    expect(safeAdminRel("fonts/inter.woff2")).toBe("fonts/inter.woff2");
    expect(safeAdminRel("icon.svg")).toBe("icon.svg");
  });

  it("rejects traversal, absolute paths and unknown extensions", () => {
    expect(safeAdminRel("../secret.html")).toBeNull();
    expect(safeAdminRel("a/../b.js")).toBeNull();
    expect(safeAdminRel("/etc/passwd")).toBeNull();
    expect(safeAdminRel("run.sh")).toBeNull();
    expect(safeAdminRel("app.wasm")).toBeNull();
    expect(safeAdminRel("noext")).toBeNull();
    expect(safeAdminRel(42)).toBeNull();
  });
});

describe("parseAdminAppSpec", () => {
  it("keeps valid routes and defaults the dir to 'admin'", () => {
    const spec = parseAdminAppSpec({
      routes: [
        { path: "/admin/forms", entry: "index.html", title: "Forms" },
        { path: "/admin/forms/submissions", entry: "index.html" },
      ],
    });
    expect(spec).toEqual({
      dir: "admin",
      routes: [
        { path: "/admin/forms", entry: "index.html", title: "Forms" },
        { path: "/admin/forms/submissions", entry: "index.html", title: undefined },
      ],
    });
  });

  it("honours an explicit relative dir", () => {
    expect(
      parseAdminAppSpec({ dir: "dist/admin", routes: [{ path: "/admin/x", entry: "x.html" }] }),
    ).toMatchObject({ dir: "dist/admin" });
  });

  it("drops bad routes and returns null when none survive", () => {
    expect(
      parseAdminAppSpec({
        routes: [
          { path: "/etc/forms", entry: "index.html" }, // not /admin/*
          { path: "/admin/x", entry: "../evil.html" }, // traversal
          { path: "/admin/y", entry: "app.js" }, // not html
        ],
      }),
    ).toBeNull();
    expect(
      parseAdminAppSpec({ dir: "../up", routes: [{ path: "/admin/x", entry: "x.html" }] }),
    ).toBeNull();
    expect(parseAdminAppSpec({ routes: [] })).toBeNull();
    expect(parseAdminAppSpec(null)).toBeNull();
  });

  it("dedupes repeated paths and caps at 20", () => {
    const spec = parseAdminAppSpec({
      routes: [
        { path: "/admin/a", entry: "a.html" },
        { path: "/admin/a", entry: "b.html" },
      ],
    });
    expect(spec?.routes).toHaveLength(1);
    expect(spec?.routes[0]?.entry).toBe("a.html");

    const many = parseAdminAppSpec({
      routes: Array.from({ length: 30 }, (_, i) => ({ path: `/admin/p${i}`, entry: "i.html" })),
    });
    expect(many?.routes.length).toBe(20);
  });
});

describe("stampAdminAppUrls", () => {
  const base: AdminMenuEntry = {
    pluginId: "acme.forms",
    id: "forms",
    label: "Forms",
    path: "/admin/forms",
    icon: "✉",
    domain: "extensions",
  };

  it("attaches the entry URL and lets a route title override the label", () => {
    const [out] = stampAdminAppUrls(
      [base],
      [
        {
          pluginId: "acme.forms",
          path: "/admin/forms",
          entryUrl: "/ext/acme.forms/admin/index.html",
          title: "Form builder",
        },
      ],
    );
    expect(out.adminAppUrl).toBe("/ext/acme.forms/admin/index.html");
    expect(out.label).toBe("Form builder");
  });

  it("leaves host-rendered plugin pages untouched", () => {
    const [out] = stampAdminAppUrls(
      [base],
      [
        {
          pluginId: "other.plugin",
          path: "/admin/forms",
          entryUrl: "/ext/other.plugin/admin/index.html",
        },
      ],
    );
    expect(out.adminAppUrl).toBeUndefined();
    expect(out).toBe(base);
  });

  it("is a no-op with no routes", () => {
    const items = [base];
    expect(stampAdminAppUrls(items, [])).toBe(items);
  });

  it("synthesizes a nav entry for an adminApp route the plugin did not list in adminMenu", () => {
    const out = stampAdminAppUrls(
      [],
      [
        {
          pluginId: "acme.reports",
          path: "/admin/reports",
          entryUrl: "/ext/acme.reports/admin/index.html",
          title: "Reports",
        },
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      pluginId: "acme.reports",
      id: "reports",
      label: "Reports",
      path: "/admin/reports",
      domain: "extensions",
      adminAppUrl: "/ext/acme.reports/admin/index.html",
    });
  });

  it("does not synthesize when an existing menu item already owns the path", () => {
    const out = stampAdminAppUrls(
      [base],
      [
        {
          pluginId: "acme.forms",
          path: "/admin/forms",
          entryUrl: "/ext/acme.forms/admin/index.html",
        },
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.adminAppUrl).toBe("/ext/acme.forms/admin/index.html");
  });
});
