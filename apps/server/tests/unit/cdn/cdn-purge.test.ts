import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();

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

vi.mock("../../../src/lib/database/db.js", () => ({
  getControlDb: async () => ({
    query: async (sql: string) => (sql.includes("FROM sites") ? [{ id: "site-1" }] : []),
  }),
}));

const { cdnPurgeUrl, purgeCdnCache, resetCdnPurgeCooldown } = await import("../../../src/lib/cdn/cdn-purge.js");
const { saveCdnSettings } = await import("../../../src/lib/cdn/cdn-settings.js");

const HOST = "dirkswebsite.justflows.com";
const hostPurge = `https://api.bunny.net/purge?async=true&url=${encodeURIComponent(`https://${HOST}/*`)}`;

beforeEach(() => {
  process.env.APP_SECRET = "x".repeat(40);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BUNNY_API_KEY;
  delete process.env.BUNNY_PULL_ZONE_ID;
  store.clear();
  resetCdnPurgeCooldown();
});

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("cdn purge url", () => {
  it("builds a hostname wildcard and skips local hosts", () => {
    expect(cdnPurgeUrl("DirksWebsite.justflows.com.")).toBe("https://dirkswebsite.justflows.com/*");
    expect(cdnPurgeUrl("localhost")).toBeNull();
    expect(cdnPurgeUrl("127.0.0.1")).toBeNull();
    expect(cdnPurgeUrl("not a host")).toBeNull();
  });
});

describe("purgeCdnCache", () => {
  it("does nothing without a configured CDN", async () => {
    const fetchMock = stubFetch();
    await purgeCdnCache({ hostname: HOST });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the environment and purges once within the cooldown", async () => {
    process.env.BUNNY_API_KEY = "env-key-1234";
    const fetchMock = stubFetch();

    await purgeCdnCache({ hostname: HOST });
    await purgeCdnCache({ hostname: HOST });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string; headers: { AccessKey: string } }];
    expect(url).toBe(hostPurge);
    expect(init.method).toBe("POST");
    expect(init.headers.AccessKey).toBe("env-key-1234");
  });

  it("purges the whole pull zone when asked", async () => {
    process.env.BUNNY_API_KEY = "env-key-1234";
    process.env.BUNNY_PULL_ZONE_ID = "6743457";
    const fetchMock = stubFetch();

    await purgeCdnCache({ all: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://api.bunny.net/pullzone/6743457/purgeCache");
  });

  it("prefers the site's own connection over the environment", async () => {
    process.env.BUNNY_API_KEY = "env-key-1234";
    await saveCdnSettings("site-1", { provider: "bunny", values: { apiKey: "site-key-5678" } });
    const fetchMock = stubFetch();

    await purgeCdnCache({ hostname: HOST });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: { AccessKey: string } }];
    expect(url).toBe(hostPurge);
    expect(init.headers.AccessKey).toBe("site-key-5678");
  });

  it("falls back to the environment while the site's connection is off", async () => {
    process.env.BUNNY_API_KEY = "env-key-1234";
    await saveCdnSettings("site-1", { provider: "bunny", enabled: false, values: { apiKey: "site-key-5678" } });
    const fetchMock = stubFetch();

    await purgeCdnCache({ hostname: HOST });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: { AccessKey: string } }];
    expect(init.headers.AccessKey).toBe("env-key-1234");
  });

  it("never throws when the CDN rejects the purge", async () => {
    process.env.BUNNY_API_KEY = "env-key-1234";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(purgeCdnCache({ hostname: HOST })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("[cdn] bunny purge failed: Bunny.net rejected the API key.");
    error.mockRestore();
  });
});
