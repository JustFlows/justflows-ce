import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
const controlSettings = new Map<string, unknown>();

vi.mock("../../../src/lib/database/db.js", () => ({
  getControlDb: async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM sites")) return [{ id: "root-site" }];
      const value = controlSettings.get(`${params[0]}:${params[1]}`);
      return value === undefined ? [] : [{ value }];
    },
  }),
}));

vi.mock("../../../src/lib/settings/site-settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/settings/site-settings.js")>();
  return {
    ...actual,
    getSiteId: async () => "site-1",
    getSiteSetting: async (siteId: string, key: string) => store.get(`${siteId}:${key}`) ?? null,
    setSiteSetting: async (siteId: string, key: string, value: unknown) => {
      store.set(`${siteId}:${key}`, JSON.parse(JSON.stringify(value)));
    },
    deleteSiteSetting: async (siteId: string, key: string) => {
      store.delete(`${siteId}:${key}`);
    },
  };
});

const { CdnSettingsError, deleteCdnSettings, getCdnSettings, loadActiveCdn, loadSiteCdn, saveCdnSettings } = await import(
  "../../../src/lib/cdn/cdn-settings.js"
);

beforeEach(() => {
  process.env.APP_SECRET = "x".repeat(40);
});

afterEach(() => {
  delete process.env.BUNNY_API_KEY;
  store.clear();
  controlSettings.clear();
});

describe("cdn settings", () => {
  it("encrypts the key and only ever shows its last four characters", async () => {
    const { connection, secretsReplaced } = await saveCdnSettings("site-1", {
      provider: "bunny",
      values: { apiKey: "abcd-efgh-1234", pullZoneId: "42" },
    });

    expect(secretsReplaced).toEqual(["apiKey"]);
    expect(connection).toMatchObject({ provider: "bunny", enabled: true, values: { pullZoneId: "42" }, secrets: { apiKey: { last4: "1234" } } });
    expect(JSON.stringify(store.get("site-1:cdn_provider"))).not.toContain("abcd-efgh-1234");
    expect(JSON.stringify(await getCdnSettings("site-1"))).not.toContain("abcd-efgh-1234");
    expect((await loadSiteCdn("site-1"))?.config).toEqual({ apiKey: "abcd-efgh-1234", pullZoneId: "42" });
  });

  it("keeps the stored key when the field is left blank", async () => {
    await saveCdnSettings("site-1", { provider: "bunny", values: { apiKey: "abcd-efgh-1234" } });
    const { secretsReplaced } = await saveCdnSettings("site-1", { provider: "bunny", values: { apiKey: "", pullZoneId: "7" } });

    expect(secretsReplaced).toEqual([]);
    expect((await loadSiteCdn("site-1"))?.config).toEqual({ apiKey: "abcd-efgh-1234", pullZoneId: "7" });
  });

  it("clears an optional field set to null", async () => {
    await saveCdnSettings("site-1", { provider: "bunny", values: { apiKey: "abcd-efgh-1234", pullZoneId: "7" } });
    await saveCdnSettings("site-1", { provider: "bunny", values: { pullZoneId: null } });

    expect((await loadSiteCdn("site-1"))?.config).toEqual({ apiKey: "abcd-efgh-1234" });
  });

  it("requires a key and rejects malformed values", async () => {
    await expect(saveCdnSettings("site-1", { provider: "bunny", values: {} })).rejects.toBeInstanceOf(CdnSettingsError);
    await expect(
      saveCdnSettings("site-1", { provider: "bunny", values: { apiKey: "abcd-efgh-1234", pullZoneId: "zone" } }),
    ).rejects.toThrow("Pull zone ID is not valid.");
  });

  it("purges a customer site through the platform connection, not its own", async () => {
    await saveCdnSettings("root-site", { provider: "bunny", values: { apiKey: "root-key-1234" } });
    await saveCdnSettings("customer", { provider: "bunny", values: { apiKey: "cust-key-1234" } });
    controlSettings.set("root-site:cdn_provider", store.get("root-site:cdn_provider"));

    expect((await loadActiveCdn("customer"))?.config).toEqual({ apiKey: "root-key-1234" });
    expect((await loadActiveCdn("root-site"))?.config).toEqual({ apiKey: "root-key-1234" });
  });

  it("reports the environment fallback and removes the connection", async () => {
    process.env.BUNNY_API_KEY = "env-key-1234";
    await saveCdnSettings("site-1", { provider: "bunny", values: { apiKey: "abcd-efgh-1234" } });

    expect(await deleteCdnSettings("site-1")).toBe(true);
    expect(await getCdnSettings("site-1")).toEqual({ connection: null, environmentFallback: true });
    expect(await deleteCdnSettings("site-1")).toBe(false);
  });
});
