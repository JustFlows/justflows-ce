import { describe, expect, it } from "vitest";
import {
  challengeName,
  challengeValue,
  checkNameserverDomain,
  checkNameservers,
  checkRecords,
  mergeResolvers,
  type DnsResolver,
} from "../../../src/lib/domains/dns-check.js";

function resolver(records: {
  txt?: Record<string, string[][]>;
  cname?: Record<string, string[]>;
  a?: Record<string, string[]>;
  aaaa?: Record<string, string[]>;
  ns?: Record<string, string[]>;
}): DnsResolver {
  const lookup = <T>(table: Record<string, T> | undefined, name: string): Promise<T> =>
    table && name in table
      ? Promise.resolve(table[name] as T)
      : Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
  return {
    resolveTxt: (name) => lookup(records.txt, name),
    resolveCname: (name) => lookup(records.cname, name),
    resolve4: (name) => lookup(records.a, name),
    resolve6: (name) => lookup(records.aaaa, name),
    resolveNs: (name) => lookup(records.ns, name),
  };
}

const base = {
  hostname: "shop.example.com",
  token: "abc123",
  cnameTarget: "justflows.b-cdn.net",
  apexAddresses: [],
};

describe("records check", () => {
  it("passes with the TXT challenge and a CNAME to the target", async () => {
    const result = await checkRecords(
      base,
      resolver({
        txt: { [challengeName("shop.example.com")]: [[challengeValue("abc123")]] },
        cname: { "shop.example.com": ["JustFlows.b-cdn.net."] },
      }),
    );
    expect(result).toEqual({ ownership: true, routing: true, problem: "" });
  });

  it("accepts a TXT value split into chunks", async () => {
    const value = challengeValue("abc123");
    const result = await checkRecords(
      base,
      resolver({
        txt: { [challengeName("shop.example.com")]: [[value.slice(0, 10), value.slice(10)]] },
        cname: { "shop.example.com": ["justflows.b-cdn.net"] },
      }),
    );
    expect(result.ownership).toBe(true);
  });

  it("does not pass without the challenge, even when the domain points here", async () => {
    const result = await checkRecords(
      base,
      resolver({
        txt: { [challengeName("shop.example.com")]: [["justflows-verify=someone-else"]] },
        cname: { "shop.example.com": ["justflows.b-cdn.net"] },
      }),
    );
    expect(result.ownership).toBe(false);
    expect(result.problem).toContain("_justflows.shop.example.com");
  });

  it("accepts a flattened apex whose addresses match the target", async () => {
    const result = await checkRecords(
      { ...base, hostname: "example.com" },
      resolver({
        txt: { [challengeName("example.com")]: [[challengeValue("abc123")]] },
        a: {
          "example.com": ["198.51.100.7"],
          "justflows.b-cdn.net": ["198.51.100.7", "198.51.100.8"],
        },
      }),
    );
    expect(result.routing).toBe(true);
  });

  it("accepts the configured apex addresses", async () => {
    const result = await checkRecords(
      { ...base, hostname: "example.com", cnameTarget: "", apexAddresses: ["203.0.113.10"] },
      resolver({
        txt: { [challengeName("example.com")]: [[challengeValue("abc123")]] },
        a: { "example.com": ["203.0.113.10"] },
      }),
    );
    expect(result.routing).toBe(true);
  });

  it("accepts a flattened apex when the target rotates through its address pool", async () => {
    const targetAnswers = [["198.51.100.9"], ["198.51.100.7"], ["198.51.100.8"]];
    let calls = 0;
    const stable = resolver({
      txt: { [challengeName("example.com")]: [[challengeValue("abc123")]] },
      a: { "example.com": ["198.51.100.7"] },
      aaaa: { "example.com": ["2001:db8::5"], "justflows.b-cdn.net": ["2001:db8::4"] },
    });
    const result = await checkRecords({ ...base, hostname: "example.com" }, {
      ...stable,
      resolve4: (name) => {
        if (name !== "justflows.b-cdn.net") return Promise.resolve(["198.51.100.7"]);
        const answer = targetAnswers[calls] ?? targetAnswers[targetAnswers.length - 1] ?? [];
        calls += 1;
        return Promise.resolve(answer);
      },
    });
    expect(result).toEqual({ ownership: true, routing: true, problem: "" });
    expect(calls).toBeGreaterThan(1);
  });

  it("accepts the authoritative address when a public resolver still has the previous one", async () => {
    const asked: string[] = [];
    const result = await checkRecords(
      { ...base, hostname: "example.com" },
      resolver({
        txt: { [challengeName("example.com")]: [[challengeValue("abc123")]] },
        ns: {
          "example.com": ["ns1.example.net"],
          "justflows.b-cdn.net": ["ns1.cdn.test"],
        },
        a: {
          "example.com": ["192.0.2.1"],
          "justflows.b-cdn.net": ["198.51.100.8"],
          "ns1.example.net": ["192.0.2.53"],
          "ns1.cdn.test": ["192.0.2.54", "127.0.0.1"],
        },
      }),
      (server) => {
        asked.push(server);
        if (server === "192.0.2.53") return resolver({ a: { "example.com": ["198.51.100.7"] } });
        const answers = [["198.51.100.9"], ["198.51.100.7"]];
        let calls = 0;
        return {
          resolveTxt: () => Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" })),
          resolveCname: () => Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" })),
          resolveNs: () => Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" })),
          resolve6: () => Promise.resolve([]),
          resolve4: () => {
            const answer = answers[Math.min(calls, answers.length - 1)] ?? [];
            calls += 1;
            return Promise.resolve(answer);
          },
        };
      },
    );
    expect(result).toEqual({ ownership: true, routing: true, problem: "" });
    expect(asked).toContain("192.0.2.53");
    expect(asked).not.toContain("127.0.0.1");
  });

  it("combines addresses from more than one resolver", async () => {
    const merged = mergeResolvers([
      resolver({ a: { "cdn.example.net": ["198.51.100.7"] } }),
      resolver({ a: { "cdn.example.net": ["198.51.100.8"] } }),
    ]);
    await expect(merged.resolve4("cdn.example.net")).resolves.toEqual(["198.51.100.7", "198.51.100.8"]);
  });

  it("reports a domain that points elsewhere", async () => {
    const result = await checkRecords(
      base,
      resolver({
        txt: { [challengeName("shop.example.com")]: [[challengeValue("abc123")]] },
        a: { "shop.example.com": ["192.0.2.1"], "justflows.b-cdn.net": ["198.51.100.7"] },
      }),
    );
    expect(result).toMatchObject({ ownership: true, routing: false });
  });
});

describe("nameservers check", () => {
  it("needs every expected nameserver", async () => {
    const ok = await checkNameservers(
      "example.com",
      ["ns1.justflows.com", "ns2.justflows.com"],
      resolver({
        ns: { "example.com": ["NS2.justflows.com.", "ns1.justflows.com"] },
      }),
    );
    expect(ok.routing).toBe(true);
    const partial = await checkNameservers(
      "example.com",
      ["ns1.justflows.com", "ns2.justflows.com"],
      resolver({
        ns: { "example.com": ["ns1.justflows.com", "ns1.other.net"] },
      }),
    );
    expect(partial.routing).toBe(false);
  });

  it("never passes with no expected nameservers", async () => {
    expect(
      (await checkNameservers("example.com", [], resolver({ ns: { "example.com": [] } })))
        .routing,
    ).toBe(false);
  });
});

describe("nameserver domain ownership", () => {
  const expected = ["kiki.bunny.net", "coco.bunny.net"];
  const challenge = { [challengeName("example.com")]: [[challengeValue("abc123")]] };

  it("accepts the exact TXT challenge after delegation to the shared nameservers", async () => {
    const result = await checkNameserverDomain(
      { hostname: "example.com", token: "abc123", expected, ownershipProven: false },
      resolver({ ns: { "example.com": expected }, txt: challenge }),
    );
    expect(result).toEqual({ ownership: true, routing: true, provenNow: true, problem: "" });
  });

  it.each([
    ["missing", undefined],
    ["wrong token", { [challengeName("example.com")]: [[challengeValue("someone-else")]] }],
    ["wrong hostname", { "example.com": [[challengeValue("abc123")]] }],
  ])("rejects a %s challenge even when nameservers match", async (_label, txt) => {
    const result = await checkNameserverDomain(
      { hostname: "example.com", token: "abc123", expected, ownershipProven: false },
      resolver({ ns: { "example.com": expected }, txt }),
    );
    expect(result).toMatchObject({ ownership: false, routing: true, provenNow: false });
    expect(result.problem).toContain("_justflows.example.com");
    expect(result.problem).not.toContain("point the nameservers back");
  });

  it("does not prove ownership with an empty token", async () => {
    const result = await checkNameserverDomain(
      { hostname: "example.com", token: "", expected, ownershipProven: false },
      resolver({ ns: { "example.com": expected }, txt: {
        [challengeName("example.com")]: [[challengeValue("")]],
      } }),
    );
    expect(result.ownership).toBe(false);
  });

  it("proves ownership with the TXT challenge while the domain is still on its own DNS", async () => {
    const result = await checkNameserverDomain(
      { hostname: "example.com", token: "abc123", expected, ownershipProven: false },
      resolver({ ns: { "example.com": ["ns1.registrar.example"] }, txt: challenge }),
    );
    expect(result).toMatchObject({ ownership: true, routing: false, provenNow: true });
  });

  it("routes once proven ownership is followed by the delegation", async () => {
    const result = await checkNameserverDomain(
      { hostname: "example.com", token: "abc123", expected, ownershipProven: true },
      resolver({ ns: { "example.com": expected } }),
    );
    expect(result).toMatchObject({ ownership: true, routing: true, problem: "" });
  });
});
