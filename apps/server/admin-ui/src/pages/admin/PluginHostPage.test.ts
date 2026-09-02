import { afterEach, describe, expect, it } from "vitest";
import { matchPluginMenuItem } from "./PluginHostPage";
import { setAdminSsrPayload } from "../../ssr-data";
import type { PluginMenuItem } from "../../config/admin-nav";

const items: PluginMenuItem[] = [
  {
    pluginId: "justflows.consent",
    id: "consent",
    label: "Cookie Consent",
    path: "/admin/consent",
    icon: "🍪",
    domain: "security",
  },
  {
    pluginId: "justflows.shop",
    id: "products",
    label: "Products",
    path: "/admin/shop/products",
    icon: "📦",
    domain: "commerce",
  },
];

afterEach(() => setAdminSsrPayload(null));

describe("matchPluginMenuItem", () => {
  it("matches canonical /admin paths when the admin URL is the default", () => {
    expect(matchPluginMenuItem(items, "/admin/consent")?.pluginId).toBe("justflows.consent");
    expect(matchPluginMenuItem(items, "/admin/shop/products/42")?.id).toBe("products");
  });

  it("matches when the admin URL has been moved", () => {
    setAdminSsrPayload({ url: "/", locale: "en-US", adminBasePath: "/admin-test", responses: {} });
    expect(matchPluginMenuItem(items, "/admin-test/consent")?.pluginId).toBe("justflows.consent");
    expect(matchPluginMenuItem(items, "/admin-test/shop/products/42")?.id).toBe("products");
    expect(matchPluginMenuItem(items, "/admin/consent")?.pluginId).toBe("justflows.consent");
  });

  it("returns undefined for an unrelated path", () => {
    setAdminSsrPayload({ url: "/", locale: "en-US", adminBasePath: "/admin-test", responses: {} });
    expect(matchPluginMenuItem(items, "/admin-test/settings")).toBeUndefined();
  });
});
