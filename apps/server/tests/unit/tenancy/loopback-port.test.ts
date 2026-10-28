import { describe, expect, it } from "vitest";
import { loopbackPort, runWithTenant, type TenantRequestContext } from "../../../src/lib/tenancy/context.js";
import { siteOrigin } from "../../../src/lib/rendering/site-origin.js";

function context(hostname: string, devPort?: string): TenantRequestContext {
  return {
    tenantId: "t",
    siteId: "s",
    hostname,
    ...(devPort ? { devPort } : {}),
    userMode: "isolated",
    databaseMode: "current",
    activePluginIds: null,
  };
}

describe("loopbackPort", () => {
  it("keeps the port of a loopback host", () => {
    expect(loopbackPort("localhost", "localhost:3000")).toBe("3000");
    expect(loopbackPort("demo.localhost", "demo.localhost:3000")).toBe("3000");
    expect(loopbackPort("127.0.0.1", "127.0.0.1:8080")).toBe("8080");
  });

  it("ignores public hosts, missing ports, and port 80", () => {
    expect(loopbackPort("example.com", "example.com:3000")).toBeUndefined();
    expect(loopbackPort("localhost", "localhost")).toBeUndefined();
    expect(loopbackPort("localhost", "localhost:80")).toBeUndefined();
    expect(loopbackPort("localhost", "localhost:99999")).toBeUndefined();
    expect(loopbackPort("localhost", undefined)).toBeUndefined();
  });
});

describe("siteOrigin", () => {
  it("includes the development port on loopback hosts", () => {
    expect(runWithTenant(context("localhost", "3000"), () => siteOrigin())).toBe("http://localhost:3000");
    expect(runWithTenant(context("demo.localhost", "3000"), () => siteOrigin())).toBe("http://demo.localhost:3000");
  });

  it("keeps public hosts on https without a port", () => {
    expect(runWithTenant(context("example.com"), () => siteOrigin())).toBe("https://example.com");
  });
});
