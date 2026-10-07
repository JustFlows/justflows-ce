import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
  detach: vi.fn(),
  deleteZone: vi.fn(),
}));

vi.mock("../../../src/lib/database/db.js", () => {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM site_domains WHERE id = ? AND site_id = ?"))
        return m.rows.filter((row) => row.id === params[0]);
      if (sql.includes("FROM site_domains WHERE parent_id = ?"))
        return m.rows.filter((row) => row.parent_id === params[0]);
      if (sql.includes("FROM site_domains WHERE site_id = ?"))
        return m.rows.filter((row) => !m.deleted.includes(String(row.id)));
      return [];
    },
    run: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("DELETE FROM site_domains")) m.deleted.push(String(params[0]));
    },
  };
  return {
    getControlDb: async () => ({
      ...client,
      transaction: async (fn: (tx: typeof client) => Promise<void>) => fn(client),
    }),
  };
});

vi.mock("../../../src/lib/domains/domain-settings.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/domains/domain-settings.js")>();
  return {
    ...actual,
    readDomainSettings: async () => ({
      ...actual.defaultDomainSettings(),
      enabled: true,
      provider: "bunny",
    }),
  };
});

vi.mock("../../../src/lib/domains/providers/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/domains/providers/index.js")>();
  return {
    ...actual,
    domainProviderFor: async () => ({
      ...actual.manualDomainProvider,
      id: "bunny",
      detachHostname: m.detach,
      deleteZone: m.deleteZone,
    }),
  };
});

vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({
  getRuntimeHooks: () => ({
    dispatchAction: async () => undefined,
    dispatchGate: async () => undefined,
  }),
}));

const { removeCustomDomain } = await import("../../../src/lib/domains/custom-domains.js");
const { DomainProviderError } = await import("../../../src/lib/domains/providers/types.js");

const parent = "11111111-1111-4111-8111-111111111111";
const www = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  m.deleted = [];
  m.detach.mockReset().mockResolvedValue(undefined);
  m.deleteZone.mockReset().mockResolvedValue(undefined);
  const base = {
    site_id: "site",
    kind: "custom",
    verified: false,
    is_primary: false,
    status: "pending",
    connect_mode: "nameservers",
    provider: "bunny",
    check_failures: 0,
    created_at: "2026-10-07 10:00:00",
  };
  m.rows = [
    { ...base, id: parent, hostname: "example.com", parent_id: null, dns_zone_id: "910531" },
    { ...base, id: www, hostname: "www.example.com", parent_id: parent, dns_zone_id: null },
  ];
});

function markAttached() {
  m.rows = m.rows.map((row) => ({ ...row, verified: true, status: "active", provider_attached_at: "2026-10-07 11:00:00" }));
}

describe("removing a custom domain", () => {
  it("removes both hostnames and the DNS zone at the provider, then the rows", async () => {
    markAttached();
    const result = await removeCustomDomain("site", parent);
    expect(result.ok).toBe(true);
    expect(m.detach.mock.calls.map((call) => call[0])).toEqual(["example.com", "www.example.com"]);
    expect(m.deleteZone).toHaveBeenCalledWith("910531");
    expect(m.deleted).toEqual([parent, www]);
  });

  it("keeps the domain when the provider refuses", async () => {
    markAttached();
    m.deleteZone.mockRejectedValue(new DomainProviderError("Bunny.net could not be reached."));
    const result = await removeCustomDomain("site", parent);
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(!result.ok && result.error).toBe(
      "The domain was not removed. Bunny.net could not be reached. Try again.",
    );
    expect(m.detach).toHaveBeenCalledTimes(2);
    expect(m.deleted).toEqual([]);
  });

  it("never detaches a hostname an unverified claim did not attach", async () => {
    m.rows = [
      { ...m.rows[0]!, connect_mode: "records", dns_zone_id: null },
    ];
    const result = await removeCustomDomain("site", parent);
    expect(result.ok).toBe(true);
    expect(m.detach).not.toHaveBeenCalled();
    expect(m.deleted).toEqual([parent]);
  });

  it("still removes the DNS zone an unverified nameserver claim created", async () => {
    const result = await removeCustomDomain("site", parent);
    expect(result.ok).toBe(true);
    expect(m.detach).not.toHaveBeenCalled();
    expect(m.deleteZone).toHaveBeenCalledWith("910531");
  });
});
