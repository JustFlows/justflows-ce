import { describe, expect, it } from "vitest";
import { isInstallationRootRequest } from "../../../src/lib/tenancy/access.js";
import { validateDatabaseChoice } from "../../../src/lib/tenancy/choice.js";
import { runWithTenant, type TenantRequestContext } from "../../../src/lib/tenancy/context.js";
import { pickHost, signupBaseDomain, signupSiteOrigin, type HostRecord } from "../../../src/lib/tenancy/host.js";
import { createPluginTenancyApi } from "../../../src/lib/plugins/plugin-tenancy.js";

const siteA: HostRecord = {
  hostname: "a.example.com",
  siteId: "site-a",
  tenantId: "tenant-a",
  siteStatus: "active",
  tenantStatus: "active",
  userMode: "isolated",
  databaseMode: "current",
  databaseChoice: "inherit",
};

const siteB: HostRecord = {
  ...siteA,
  hostname: "b.example.com",
  siteId: "site-b",
  tenantId: "tenant-b",
};

describe("host routing", () => {
  it("does not fall back to another site when the host is unknown", () => {
    const decision = pickHost({
      hostname: "evil.example.com",
      records: [siteA, siteB],
      siteCount: 2,
    });
    expect(decision.kind).toBe("unknown");
  });

  it("resolves a registered host only to that site", () => {
    const decision = pickHost({ hostname: "B.EXAMPLE.COM", records: [siteA, siteB], siteCount: 2 });
    expect(decision.kind).toBe("ready");
    if (decision.kind === "ready") expect(decision.record.siteId).toBe("site-b");
  });

  it("refuses loopback once two sites exist", () => {
    expect(pickHost({ hostname: "localhost", records: [siteA, siteB], siteCount: 2 }).kind).toBe("unknown");
  });

  it("keeps loopback on the only site", () => {
    const decision = pickHost({ hostname: "localhost", records: [siteA], siteCount: 1 });
    expect(decision.kind).toBe("ready");
    if (decision.kind === "ready") expect(decision.record.siteId).toBe("site-a");
  });
});

describe("database choice", () => {
  it("keeps a workspace on the current database", () => {
    const result = validateDatabaseChoice({ userMode: "isolated", tenantMode: "current", siteChoice: "inherit" });
    expect(result).toEqual({ ok: true, mode: "current" });
  });

  it("requires connection details for a separate database", () => {
    const result = validateDatabaseChoice({
      userMode: "isolated",
      tenantMode: "separate",
      siteChoice: "separate",
      target: { host: "", port: 5432, database: "jf_a", username: "" },
    });
    expect(result.ok).toBe(false);
  });

  it("lets an isolated site stay on the current database", () => {
    const result = validateDatabaseChoice({
      userMode: "isolated",
      tenantMode: "separate",
      siteChoice: "current",
    });
    expect(result).toEqual({ ok: true, mode: "current" });
  });

  it("accepts a separate database when the connection is complete", () => {
    const result = validateDatabaseChoice({
      userMode: "isolated",
      tenantMode: "current",
      siteChoice: "separate",
      target: { host: "localhost", port: 5432, database: "jf_a", username: "jf", password: "" },
    });
    expect(result).toEqual({ ok: true, mode: "separate" });
  });

  it("refuses to split shared users onto a site-specific database", () => {
    const result = validateDatabaseChoice({
      userMode: "shared",
      tenantMode: "current",
      siteChoice: "separate",
      target: { host: "localhost", port: 5432, database: "jf_a", username: "jf", password: "" },
    });
    expect(result.ok).toBe(false);
  });
});

describe("signup domain", () => {
  it("keeps a hostname and strips a pasted address", () => {
    expect(signupBaseDomain("example.com")).toBe("example.com");
    expect(signupBaseDomain("http://localhost:3000/")).toBe("localhost");
    expect(signupBaseDomain("")).toBe("");
    expect(signupBaseDomain("not a host")).toBeNull();
  });

  it("keeps the signup page scheme and port on the new hostname", () => {
    expect(signupSiteOrigin("my-site.localhost", "http", "localhost:3000")).toBe("http://my-site.localhost:3000");
    expect(signupSiteOrigin("my-site.example.com", "https", "example.com")).toBe("https://my-site.example.com");
  });
});

describe("installation root", () => {
  const site: TenantRequestContext = {
    tenantId: "tenant-a",
    siteId: "site-a",
    hostname: "demo.localhost",
    userMode: "isolated",
    databaseMode: "current",
    activePluginIds: null,
  };

  it("keeps process settings on the installation site", () => {
    expect(isInstallationRootRequest()).toBe(true);
    runWithTenant({ ...site, rootSite: false }, () => {
      expect(isInstallationRootRequest()).toBe(false);
    });
    runWithTenant({ ...site, rootSite: true }, () => {
      expect(isInstallationRootRequest()).toBe(true);
    });
  });
});

describe("plugin tenancy api", () => {
  it("lets every plugin read the current workspace and keeps management behind permission", async () => {
    const open = createPluginTenancyApi("demo.plugin", new Set());
    expect(await open.current()).toBeNull();
    await expect(open.listWorkspaces()).rejects.toThrow(/platform:tenancy/);
    await expect(open.createWorkspace({
      name: "A",
      userMode: "isolated",
      databaseMode: "current",
      siteName: "A",
      hostname: "a.localhost",
      admin: { email: "a@example.com", username: "ada", displayName: "Ada", password: "long-password-1" },
    })).rejects.toThrow(/platform:tenancy/);
  });
});
