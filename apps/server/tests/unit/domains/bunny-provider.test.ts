import { describe, expect, it } from "vitest";
import { createBunnyDomainProvider } from "../../../src/lib/domains/providers/bunny.js";
import { DomainProviderError } from "../../../src/lib/domains/providers/types.js";

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function fakeFetch(handler: (call: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const call = {
      method: String(init?.method ?? "GET"),
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const { status, body } = handler(call);
    return new Response(status === 204 || body === undefined ? null : JSON.stringify(body), {
      status,
    });
  }) as typeof fetch;
  return { impl, calls };
}

const config = { apiKey: "key-123456", pullZoneId: "42" };

describe("Bunny domain provider", () => {
  it("reads the pull zone's own hostname as the CNAME target", async () => {
    const { impl, calls } = fakeFetch(() => ({
      status: 200,
      body: {
        Hostnames: [
          { Value: "my.example.com" },
          { Value: "Justflows.b-cdn.net", IsSystemHostname: true },
        ],
      },
    }));
    const provider = createBunnyDomainProvider(config, impl);
    expect(await provider.verify()).toEqual({ cnameTarget: "justflows.b-cdn.net" });
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://api.bunny.net/pullzone/42" });
  });

  it("adds a hostname, and treats one the zone already has as added", async () => {
    const { impl, calls } = fakeFetch(() => ({
      status: 400,
      body: { Message: "The hostname is already registered." },
    }));
    await createBunnyDomainProvider(config, impl).attachHostname("shop.example.com");
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.bunny.net/pullzone/42/addHostname",
      body: { Hostname: "shop.example.com" },
    });
  });

  it("reports a certificate as pending while DNS has not reached Bunny", async () => {
    const { impl } = fakeFetch((call) =>
      call.url.includes("loadFreeCertificate")
        ? { status: 400, body: { Message: "DNS not pointing" } }
        : { status: 200, body: { Hostnames: [] } },
    );
    expect(await createBunnyDomainProvider(config, impl).issueCertificate("shop.example.com")).toBe(
      "pending",
    );
  });

  it("issues a certificate and forces HTTPS", async () => {
    const { impl, calls } = fakeFetch((call) =>
      call.url.endsWith("/pullzone/42")
        ? { status: 200, body: { Hostnames: [] } }
        : { status: 204 },
    );
    expect(await createBunnyDomainProvider(config, impl).issueCertificate("shop.example.com")).toBe(
      "issued",
    );
    expect(
      calls.map((call) => `${call.method} ${call.url.replace("https://api.bunny.net", "")}`),
    ).toEqual([
      "GET /pullzone/42",
      "GET /pullzone/loadFreeCertificate?hostname=shop.example.com",
      "POST /pullzone/42/setForceSSL",
    ]);
  });

  it("creates a zone with vanity nameservers and pull zone records for apex and www", async () => {
    const { impl, calls } = fakeFetch((call) =>
      call.method === "POST" && call.url.endsWith("/dnszone")
        ? { status: 201, body: { Id: 77 } }
        : { status: 200, body: {} },
    );
    const zone = await createBunnyDomainProvider(config, impl).createZone("example.com", {
      nameservers: ["ns1.justflows.com", "ns2.justflows.com"],
      soaEmail: "hostmaster@justflows.com",
      serve: ["", "www"],
    });
    expect(zone).toEqual({ zoneId: "77", nameservers: ["ns1.justflows.com", "ns2.justflows.com"] });
    expect(calls[0]?.body).toEqual({ Domain: "example.com" });
    expect(calls[1]).toMatchObject({
      url: "https://api.bunny.net/dnszone/77",
      body: {
        CustomNameserversEnabled: true,
        Nameserver1: "ns1.justflows.com",
        Nameserver2: "ns2.justflows.com",
        SoaEmail: "hostmaster@justflows.com",
      },
    });
    expect(calls.slice(2).map((call) => call.body)).toEqual([
      { Type: 7, Name: "", Value: "", Ttl: 300, PullZoneId: 42 },
      { Type: 7, Name: "www", Value: "", Ttl: 300, PullZoneId: 42 },
    ]);
  });

  it("removes a half-made zone when a record fails", async () => {
    const { impl, calls } = fakeFetch((call) => {
      if (call.method === "POST" && call.url.endsWith("/dnszone"))
        return { status: 201, body: { Id: 78 } };
      if (call.method === "PUT") return { status: 400, body: { Message: "bad record" } };
      return { status: 204 };
    });
    await expect(
      createBunnyDomainProvider(config, impl).createZone("example.com", {
        nameservers: [],
        soaEmail: "",
        serve: [""],
      }),
    ).rejects.toBeInstanceOf(DomainProviderError);
    expect(calls.at(-1)).toMatchObject({
      method: "DELETE",
      url: "https://api.bunny.net/dnszone/78",
    });
  });

  it("lists records and marks the ones that serve the site", async () => {
    const { impl } = fakeFetch(() => ({
      status: 200,
      body: {
        Records: [
          { Id: 1, Type: 7, Name: "", PullZoneId: 42, Ttl: 300 },
          { Id: 2, Type: 4, Name: "", Value: "mx.mail.example", Priority: 10, Ttl: 3600 },
        ],
      },
    }));
    const records = await createBunnyDomainProvider(config, impl).listRecords("77");
    expect(records.map((record) => [record.type, record.managed])).toEqual([
      ["PULLZONE", true],
      ["MX", false],
    ]);
  });

  it("refuses to call without a key", async () => {
    const { impl } = fakeFetch(() => ({ status: 200 }));
    await expect(
      createBunnyDomainProvider({ apiKey: "", pullZoneId: "42" }, impl).verify(),
    ).rejects.toThrow("API key");
  });
});
