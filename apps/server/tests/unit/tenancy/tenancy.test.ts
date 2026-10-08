import { describe, expect, it } from "vitest";
import { isInstallationRootRequest, sessionMatchesRequestSite } from "../../../src/lib/tenancy/access.js";
import { sanitizeDatabaseError, validateDatabaseChoice } from "../../../src/lib/tenancy/choice.js";
import { validateSiteEdit, type SiteEditInput } from "../../../src/lib/tenancy/site-record.js";
import { runWithTenant, type TenantRequestContext } from "../../../src/lib/tenancy/context.js";
import { pickHost, signupBaseDomain, signupSiteOrigin, siteDomainKind, type HostRecord } from "../../../src/lib/tenancy/host.js";
import { buildSaasSettings, readSaasSettings, readSignupDatabaseTarget, withPurgeAfterDays } from "../../../src/lib/tenancy/saas-settings.js";
import { deletedLongEnough } from "../../../src/lib/tenancy/purge-deleted.js";
import { createPluginTenancyApi } from "../../../src/lib/plugins/plugin-tenancy.js";

function siteEdit(overrides: Partial<SiteEditInput> = {}): SiteEditInput {
  return {
    name: "Site A",
    description: "A customer site",
    url: "https://a.example.com",
    status: "active",
    databaseChoice: "inherit",
    domains: [{ id: null, hostname: "A.EXAMPLE.COM", kind: "custom", verified: true, isPrimary: true }],
    database: null,
    ...overrides,
  };
}

function siteContext(overrides: Partial<Parameters<typeof validateSiteEdit>[1]> = {}): Parameters<typeof validateSiteEdit>[1] {
  return {
    currentStatus: "active",
    currentChoice: "inherit",
    userMode: "isolated",
    tenantMode: "current",
    siteDatabase: false,
    takenHostnames: new Set<string>(),
    ...overrides,
  };
}

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

describe("domain kind", () => {
  it("calls a hostname under the platform domain a subdomain", () => {
    expect(siteDomainKind("dirkswebsite.justflows.com", "justflows.com")).toBe("subdomain");
    expect(siteDomainKind("DIRKSWEBSITE.JUSTFLOWS.COM", "JustFlows.com")).toBe("subdomain");
  });

  it("does not treat the platform domain itself as a subdomain", () => {
    expect(siteDomainKind("justflows.com", "justflows.com")).toBe("custom");
  });

  it("keeps a hostname outside the platform domain as a custom domain", () => {
    expect(siteDomainKind("example.com", "justflows.com")).toBe("custom");
    expect(siteDomainKind("notjustflows.com", "justflows.com")).toBe("custom");
  });

  it("keeps loopback as primary and a customer slug as a subdomain", () => {
    expect(siteDomainKind("localhost", "justflows.com")).toBe("primary");
    expect(siteDomainKind("construction-demo", "justflows.com")).toBe("subdomain");
  });
});

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

describe("database connection errors", () => {
  it("keeps the nested reason when the driver wraps a refused connection", () => {
    const nested = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    const wrapped = new AggregateError([nested], "");
    expect(sanitizeDatabaseError(wrapped, "secret-db-password")).toContain("ECONNREFUSED");
    expect(sanitizeDatabaseError(new Error("password secret-db-password rejected"), "secret-db-password")).toBe("password [redacted] rejected");
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

  it("accepts a website rename that keeps one primary domain", () => {
    const result = validateSiteEdit(siteEdit(), siteContext());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.domains[0]?.hostname).toBe("a.example.com");
  });

  it("rejects two primary addresses", () => {
    const input = siteEdit();
    input.domains.push({ id: null, hostname: "www.a.example.com", kind: "custom", verified: false, isPrimary: true });
    expect(validateSiteEdit(input, siteContext()).ok).toBe(false);
  });

  it("rejects a hostname another website already uses", () => {
    const result = validateSiteEdit(siteEdit(), siteContext({ takenHostnames: new Set(["a.example.com"]) }));
    expect(result.ok).toBe(false);
  });

  it("rejects a site URL on a domain that is not listed", () => {
    const input = siteEdit({ url: "https://other.example.com" });
    expect(validateSiteEdit(input, siteContext()).ok).toBe(false);
  });

  it("rejects moving a website off the database it already uses", () => {
    const result = validateSiteEdit(siteEdit({ databaseChoice: "current" }), siteContext({ tenantMode: "separate" }));
    expect(result.ok).toBe(false);
  });

  it("rejects edits while a website is deleted", () => {
    expect(validateSiteEdit(siteEdit(), siteContext({ currentStatus: "deleted" })).ok).toBe(false);
  });

  it("rejects changing the workspace database from a website page", () => {
    const result = validateSiteEdit(
      siteEdit({
        database: { host: "db.internal", port: 5432, database: "jf_a", username: "jf", password: "" },
      }),
      siteContext(),
    );
    expect(result.ok).toBe(false);
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
    expect(signupSiteOrigin("my-site.example.com", "javascript", "example.com")).toBe("https://my-site.example.com");
    expect(signupSiteOrigin("my-site.example.com", "https", "example.com:99999")).toBe("https://my-site.example.com");
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

  it("accepts a credential only for the site this request is serving", () => {
    expect(sessionMatchesRequestSite("site-b")).toBe(true);
    runWithTenant({ ...site, siteId: "site-a", rootSite: false }, () => {
      expect(sessionMatchesRequestSite("site-a")).toBe(true);
      expect(sessionMatchesRequestSite("site-b")).toBe(false);
    });
  });

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

describe("saas settings", () => {
  it("reads a jsonb object and a jsonb string written by a double-encoded insert", () => {
    expect(readSaasSettings({ signupEnabled: true, baseDomain: "justflows.com" })).toEqual({
      signupEnabled: true,
      signupDatabaseMode: "current",
      baseDomain: "justflows.com",
      signupDatabase: null,
      purgeAfterDays: 30,
    });
    expect(readSaasSettings('{"signupEnabled":true,"baseDomain":"justflows.com"}')).toEqual({
      signupEnabled: true,
      signupDatabaseMode: "current",
      baseDomain: "justflows.com",
      signupDatabase: null,
      purgeAfterDays: 30,
    });
    expect(readSaasSettings(null)).toBeNull();
  });

  it("keeps the signup database password out of the platform page and reuses it when left blank", () => {
    process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";
    const first = buildSaasSettings(null, {
      signupEnabled: true,
      signupDatabaseMode: "separate",
      baseDomain: "justflows.com",
      database: { host: "db.internal", port: 5432, database: "customers", username: "justflows", password: "secret-db-password" },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const shown = readSaasSettings(first.stored);
    expect(shown?.signupDatabase).toEqual({
      host: "db.internal",
      port: 5432,
      database: "customers",
      username: "justflows",
      passwordSet: true,
    });
    expect(JSON.stringify(shown)).not.toContain("secret-db-password");
    expect(readSignupDatabaseTarget(first.stored)?.password).toBe("secret-db-password");

    const kept = buildSaasSettings(first.stored, {
      signupEnabled: true,
      signupDatabaseMode: "separate",
      baseDomain: "justflows.com",
      database: { host: "db.internal", port: 5432, database: "customers", username: "justflows", password: "" },
    });
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(readSignupDatabaseTarget(kept.stored)?.password).toBe("secret-db-password");
    expect(readSaasSettings(kept.stored)?.purgeAfterDays).toBe(30);
    const timed = withPurgeAfterDays(kept.stored, 14);
    expect(timed.purgeAfterDays).toBe(14);
    expect(readSignupDatabaseTarget(timed)?.password).toBe("secret-db-password");
  });
});

describe("deleted website cleanup", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");

  it("waits the configured number of days and never runs when the wait is 0", () => {
    expect(deletedLongEnough("2026-10-04 12:00:00", 1, now)).toBe(true);
    expect(deletedLongEnough("2026-10-04 12:00:01", 1, now)).toBe(false);
    expect(deletedLongEnough(new Date("2026-09-01T12:00:00Z"), 30, now)).toBe(true);
    expect(deletedLongEnough("2026-10-01 12:00:00", 0, now)).toBe(false);
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
