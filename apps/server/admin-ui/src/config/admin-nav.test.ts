import { describe, expect, it } from "vitest";
import { ADMIN_NAV_DOMAINS, canAccessPath, filterDomainsByRole, navRuleFor } from "./admin-nav";

describe("navRuleFor", () => {
  it("matches a nested route to its owning nav rule", () => {
    expect(navRuleFor("/admin/users")).toBe("/admin/users");
    expect(navRuleFor("/admin/users/some-id")).toBe("/admin/users");
    expect(navRuleFor("/admin/security/headers")).toBe("/admin/security/headers");
    expect(navRuleFor("/admin/security")).toBe("/admin/security");
  });

  it("returns null for a page with no core rule", () => {
    expect(navRuleFor("/admin/content")).toBeNull();
    expect(navRuleFor("/admin/settings")).toBeNull();
  });
});

describe("canAccessPath", () => {
  it("denies everything without a role", () => {
    expect(canAccessPath(null, "/admin/content")).toBe(false);
    expect(canAccessPath(undefined, "/admin")).toBe(false);
  });

  it("allows any admin-eligible role onto a page with no core rule", () => {
    for (const role of ["administrator", "editor", "author", "contributor"]) {
      expect(canAccessPath(role, "/admin/content")).toBe(true);
      expect(canAccessPath(role, "/admin/settings")).toBe(true);
    }
  });

  it("gates Users to administrator and editor only", () => {
    expect(canAccessPath("administrator", "/admin/users")).toBe(true);
    expect(canAccessPath("editor", "/admin/users")).toBe(true);
    expect(canAccessPath("author", "/admin/users")).toBe(false);
    expect(canAccessPath("contributor", "/admin/users")).toBe(false);
  });

  it("gates Media to everyone but a contributor", () => {
    expect(canAccessPath("author", "/admin/media")).toBe(true);
    expect(canAccessPath("contributor", "/admin/media")).toBe(false);
  });

  it("gates the admin-only sections to administrator alone", () => {
    for (const path of ["/admin/marketplace", "/admin/tools", "/admin/health", "/admin/updates", "/admin/security", "/admin/security/audit"]) {
      expect(canAccessPath("administrator", path)).toBe(true);
      expect(canAccessPath("editor", path)).toBe(false);
    }
  });

  it("leaves the Security > Account page open to every admin-eligible role", () => {
    for (const role of ["administrator", "editor", "author", "contributor"]) {
      expect(canAccessPath(role, "/admin/security/account")).toBe(true);
    }
  });
});

describe("filterDomainsByRole", () => {
  it("drops items an author can't open, and empties domains left with none", () => {
    const filtered = filterDomainsByRole(ADMIN_NAV_DOMAINS, "author");
    const paths = filtered.flatMap((d) => d.items.map((i) => i.to));

    expect(paths).toContain("/admin/content");
    expect(paths).toContain("/admin/media");
    expect(paths).not.toContain("/admin/comments");
    expect(paths).not.toContain("/admin/users");
    // Extensions domain (plugins + marketplace) has nothing an author can open.
    expect(filtered.find((d) => d.slug === "extensions")).toBeUndefined();
  });

  it("keeps every domain for an administrator", () => {
    const filtered = filterDomainsByRole(ADMIN_NAV_DOMAINS, "administrator");
    expect(filtered.map((d) => d.slug)).toEqual(ADMIN_NAV_DOMAINS.map((d) => d.slug));
  });
});
