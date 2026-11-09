import { afterEach, describe, expect, it } from "vitest";
import { matchPluginMenuItem } from "../../../../src/pages/admin/extensions/PluginHostPage";
import { setAdminSsrPayload } from "../../../../src/ssr-data";
import type { PluginMenuItem } from "../../../../src/config/admin-nav";

const items: PluginMenuItem[] = [
  {
    pluginId: "justflows.privacy",
    id: "consent",
    label: "Privacy",
    path: "/admin/plugins/justflows.privacy",
    icon: "🍪",
    domain: "security",
  },
  {
    pluginId: "justflows.store",
    id: "products",
    label: "Products",
    path: "/admin/plugins/justflows.store/products",
    icon: "📦",
    domain: "commerce",
  },
];

afterEach(() => setAdminSsrPayload(null));

describe("matchPluginMenuItem", () => {
  it("matches canonical /admin paths when the admin URL is the default", () => {
    expect(matchPluginMenuItem(items, "/admin/plugins/justflows.privacy")?.pluginId).toBe(
      "justflows.privacy",
    );
    expect(matchPluginMenuItem(items, "/admin/plugins/justflows.store/products/42")?.id).toBe(
      "products",
    );
  });

  it("matches when the admin URL has been moved", () => {
    setAdminSsrPayload({ url: "/", locale: "en-US", adminBasePath: "/admin-test", responses: {} });
    expect(matchPluginMenuItem(items, "/admin-test/plugins/justflows.privacy")?.pluginId).toBe(
      "justflows.privacy",
    );
    expect(matchPluginMenuItem(items, "/admin-test/plugins/justflows.store/products/42")?.id).toBe(
      "products",
    );
    expect(matchPluginMenuItem(items, "/admin/plugins/justflows.privacy")?.pluginId).toBe(
      "justflows.privacy",
    );
  });

  it("returns undefined for an unrelated path", () => {
    setAdminSsrPayload({ url: "/", locale: "en-US", adminBasePath: "/admin-test", responses: {} });
    expect(matchPluginMenuItem(items, "/admin-test/settings")).toBeUndefined();
  });
});
