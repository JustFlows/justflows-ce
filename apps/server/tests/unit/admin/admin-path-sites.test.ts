import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  siteId: null as string | null,
  settings: new Map<string, unknown>(),
}));

vi.mock("../../../src/lib/settings/site-settings.js", () => ({
  getSiteId: async () => state.siteId,
  getSiteSetting: async (siteId: string, key: string) => state.settings.get(`${siteId}:${key}`) ?? null,
  setSiteSetting: async (siteId: string, key: string, value: unknown) => {
    state.settings.set(`${siteId}:${key}`, value);
  },
}));

const { clearAdminPathCache, getAdminPathConfig, saveAdminPathConfig } = await import(
  "../../../src/lib/admin/admin-path.js"
);

describe("admin path per site", () => {
  beforeEach(() => {
    state.siteId = null;
    state.settings.clear();
    clearAdminPathCache();
    delete process.env.JF_ADMIN_PATH_RECOVERY;
  });

  it("keeps one site's custom path off every other site", async () => {
    state.siteId = "platform";
    await saveAdminPathConfig({ path: "/platformadmin", oldPathBehavior: "not_found" });

    state.siteId = "customer";
    expect(await getAdminPathConfig()).toEqual({ path: "/admin", oldPathBehavior: "not_found" });

    state.siteId = "platform";
    expect(await getAdminPathConfig()).toEqual({ path: "/platformadmin", oldPathBehavior: "not_found" });
  });

  it("does not reuse a path loaded before the site was known", async () => {
    expect(await getAdminPathConfig()).toEqual({ path: "/admin", oldPathBehavior: "not_found" });

    state.siteId = "customer";
    state.settings.set("customer:security.admin_path", {
      path: "/studio",
      oldPathBehavior: "redirect",
    });
    expect(await getAdminPathConfig()).toEqual({ path: "/studio", oldPathBehavior: "redirect" });
  });
});
