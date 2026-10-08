import { describe, expect, it } from "vitest";
import {
  cleanCustomHostname,
  dnsInstructions,
  dueForCheck,
  validateRecordInput,
} from "../../../src/lib/domains/custom-domains.js";
import { defaultDomainSettings } from "../../../src/lib/domains/domain-settings.js";
import { primaryRedirectHost, type HostRecord } from "../../../src/lib/tenancy/host.js";

describe("custom hostname input", () => {
  it("accepts a domain or a pasted URL", () => {
    expect(cleanCustomHostname("https://Shop.Example.com/path", "justflows.com")).toEqual({
      ok: true,
      hostname: "shop.example.com",
    });
    expect(cleanCustomHostname("example.com.", "justflows.com")).toEqual({
      ok: true,
      hostname: "example.com",
    });
  });

  it("refuses platform addresses, IPs, and local names", () => {
    expect(cleanCustomHostname("my-site.justflows.com", "justflows.com").ok).toBe(false);
    expect(cleanCustomHostname("justflows.com", "justflows.com").ok).toBe(false);
    expect(cleanCustomHostname("203.0.113.10", "justflows.com").ok).toBe(false);
    expect(cleanCustomHostname("site.localhost", "justflows.com").ok).toBe(false);
    expect(cleanCustomHostname("nodot", "justflows.com").ok).toBe(false);
  });
});

describe("DNS instructions", () => {
  const settings = {
    ...defaultDomainSettings(),
    provider: "bunny" as const,
    cnameTarget: "justflows.b-cdn.net",
    apexAddresses: ["203.0.113.10"],
  };

  it("asks for a TXT challenge and a CNAME on a subdomain", () => {
    expect(
      dnsInstructions(
        {
          hostname: "shop.example.com",
          connect_mode: "records",
          verification_token: "t1",
          parent_id: null,
        },
        settings,
      ),
    ).toEqual([
      {
        type: "TXT",
        name: "_justflows.shop.example.com",
        value: "justflows-verify=t1",
        purpose: "verify",
      },
      { type: "CNAME", name: "shop.example.com", value: "justflows.b-cdn.net", purpose: "route" },
    ]);
  });

  it("offers ALIAS and A records on a bare domain", () => {
    const list = dnsInstructions(
      {
        hostname: "example.com",
        connect_mode: "records",
        verification_token: "t1",
        parent_id: null,
      },
      settings,
    );
    expect(list.map((item) => item.type)).toEqual(["TXT", "ALIAS", "A"]);
  });

  it("lists Bunny's nameservers unless the platform has its own", () => {
    const row = {
      hostname: "example.com",
      connect_mode: "nameservers",
      verification_token: null,
      parent_id: null,
    };
    expect(dnsInstructions(row, settings).map((item) => item.value)).toEqual([
      "kiki.bunny.net",
      "coco.bunny.net",
    ]);
    expect(
      dnsInstructions(row, {
        ...settings,
        nameservers: ["ns1.justflows.com", "ns2.justflows.com"],
      }).map((item) => item.value),
    ).toEqual(["ns1.justflows.com", "ns2.justflows.com"]);
  });
});

describe("zone record input", () => {
  it("accepts an MX record and defaults its priority", () => {
    expect(validateRecordInput({ type: "MX", name: "@", value: "mx.mail.example" })).toEqual({
      ok: true,
      record: { type: "MX", name: "", value: "mx.mail.example", ttl: 3600, priority: 10 },
    });
  });

  it("refuses a CNAME on the apex, the reserved challenge name, and unknown types", () => {
    expect(validateRecordInput({ type: "CNAME", name: "", value: "other.example" }).ok).toBe(false);
    expect(validateRecordInput({ type: "TXT", name: "_justflows", value: "x" }).ok).toBe(false);
    expect(validateRecordInput({ type: "NS", name: "sub", value: "ns.example" }).ok).toBe(false);
    expect(validateRecordInput({ type: "A", name: "www", value: "not-an-ip" }).ok).toBe(false);
  });
});

describe("check schedule", () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  it("checks pending domains often and active ones rarely", () => {
    expect(dueForCheck({ status: "pending", checked_at: null })).toBe(true);
    expect(dueForCheck({ status: "pending", checked_at: ago(60_000) })).toBe(false);
    expect(dueForCheck({ status: "pending", checked_at: ago(5 * 60_000) })).toBe(true);
    expect(dueForCheck({ status: "active", checked_at: ago(60 * 60_000) })).toBe(false);
    expect(dueForCheck({ status: "active", checked_at: ago(7 * 60 * 60_000) })).toBe(true);
  });
});

describe("primary domain redirect", () => {
  const record: HostRecord = {
    hostname: "my-site.justflows.com",
    siteId: "s",
    tenantId: "t",
    siteStatus: "active",
    tenantStatus: "active",
    userMode: "isolated",
    databaseMode: "current",
    databaseChoice: "inherit",
    primaryHostname: "example.com",
    primaryCustom: true,
  };
  const ask = (overrides: Partial<Parameters<typeof primaryRedirectHost>[0]> = {}) =>
    primaryRedirectHost({
      record,
      viaLoopback: false,
      method: "GET",
      path: "/blog/hello",
      adminBase: "/admin",
      ...overrides,
    });

  it("sends a public page to the custom primary domain", () => {
    expect(ask()).toBe("example.com");
  });

  it("keeps admin, API, uploads, and a custom admin path on the address used", () => {
    expect(ask({ path: "/admin/settings" })).toBeNull();
    expect(ask({ path: "/api/content" })).toBeNull();
    expect(ask({ path: "/uploads/s/a.png" })).toBeNull();
    expect(ask({ path: "/backstage", adminBase: "/backstage" })).toBeNull();
  });

  it("does nothing for a POST, on the primary itself, or when the primary is the platform's", () => {
    expect(ask({ method: "POST" })).toBeNull();
    expect(ask({ record: { ...record, hostname: "example.com" } })).toBeNull();
    expect(ask({ record: { ...record, primaryCustom: false } })).toBeNull();
  });
});
