// @vitest-environment node

import { describe, expect, it } from "vitest";
import { render } from "./entry-server";

const ROUTES = [
  "/install", "/login", "/register", "/admin", "/admin/content",
  "/admin/content/new", "/admin/content/example", "/admin/content/example/builder",
  "/admin/content-types", "/admin/media", "/admin/plugins", "/admin/plugins/demo/settings",
  "/admin/analytics", "/admin/forms", "/admin/themes", "/admin/themes/customize",
  "/admin/design", "/admin/menus", "/admin/users", "/admin/settings", "/admin/comments",
  "/admin/marketplace", "/admin/tools", "/admin/health", "/admin/updates", "/admin/languages",
  "/admin/security", "/admin/security/headers", "/admin/security/advanced",
  "/admin/security/account", "/admin/security/audit",
];

describe("admin SSR routes", () => {
  for (const url of ROUTES) {
    it(`renders ${url} without browser globals`, () => {
      const html = render(url, { url, locale: "en", responses: {} });
      expect(html.length).toBeGreaterThan(20);
    });
  }

  it("renders prefetched content into the initial HTML", () => {
    const html = render("/admin/content", {
      url: "/admin/content",
      locale: "en",
      responses: {
        "/api/content": {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: [{ id: "1", type: "post", title: "SSR post", slug: "ssr", locale: "en", status: "published", updatedAt: "2026-08-26" }] }),
        },
      },
    });
    expect(html).toContain("SSR post");
  });
});
