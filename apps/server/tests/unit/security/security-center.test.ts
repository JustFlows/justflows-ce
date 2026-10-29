// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  evaluateSecurityCenter,
  securityCenterReport,
  type SecurityCenterFacts,
} from "../../../src/lib/security/security-center.js";

const HREFS = new Set([
  null,
  "/admin/updates",
  "/admin/security/account",
  "/admin/settings/api",
  "/admin/security/headers",
]);

function facts(overrides: Partial<SecurityCenterFacts> = {}): SecurityCenterFacts {
  return {
    checkedAt: "2026-10-29T09:00:00.000Z",
    installationRoot: true,
    nodeVersion: "v22.14.0",
    minimumNodeMajor: 22,
    coreVersion: "0.3.9",
    update: { state: "current", latest: "0.3.9", checkedAt: "2026-10-29T08:00:00.000Z" },
    debugEnabled: false,
    production: true,
    installerClosed: true,
    mfa: { state: "known", admins: 2, enrolled: 2 },
    sessions: { state: "known", active: 1 },
    apiKeys: { state: "known", active: 1, withoutExpiry: 0 },
    appUrl: "https",
    cookieSecure: true,
    proxy: { mode: "bounded", value: "loopback" },
    headers: { state: "known", critical: 0, warning: 0 },
    auditAvailable: true,
    ...overrides,
  };
}

function byId(rows: ReturnType<typeof evaluateSecurityCenter>, id: string) {
  const check = rows.find((row) => row.id === id);
  if (!check) throw new Error(`missing ${id}`);
  return check;
}

describe("security center checks", () => {
  it("does not grade the site, and never treats an unread update as current", () => {
    const report = securityCenterReport(facts({ update: { state: "unknown" } }));
    expect(JSON.stringify(report)).not.toContain("grade");
    expect(JSON.stringify(report)).not.toContain("score");
    expect(byId(report.checks, "runtime.update").status).toBe("unknown");
    expect(byId(report.checks, "extensions.integrity").status).toBe("unknown");
    expect(byId(report.checks, "recovery.backup").status).toBe("unknown");
    expect(byId(report.checks, "transport.tls")).toMatchObject({
      status: "unknown",
      kind: "deployment",
      summary: "notProbed",
    });
    for (const check of report.checks) expect(HREFS.has(check.href)).toBe(true);
  });

  it("fails closed on an old runtime, production debug, a wide proxy, and critical headers", () => {
    const rows = evaluateSecurityCenter(facts({
      nodeVersion: "v18.20.0",
      debugEnabled: true,
      proxy: { mode: "wide", value: "true" },
      headers: { state: "known", critical: 2, warning: 1 },
    }));
    expect(byId(rows, "runtime.node")).toMatchObject({ status: "fail", severity: "high" });
    expect(byId(rows, "runtime.debug")).toMatchObject({ status: "fail", severity: "critical" });
    expect(byId(rows, "transport.proxy")).toMatchObject({ status: "fail", summary: "wide" });
    expect(byId(rows, "headers.policy")).toMatchObject({ status: "fail", summary: "critical" });
    expect(byId(rows, "transport.proxy").evidence.value).toBe("true");
  });

  it("warns when an administrator has no authenticator or an API key never expires", () => {
    const rows = evaluateSecurityCenter(facts({
      mfa: { state: "known", admins: 2, enrolled: 1 },
      apiKeys: { state: "known", active: 3, withoutExpiry: 2 },
      update: { state: "available", latest: "0.3.10", checkedAt: "2026-10-29T08:00:00.000Z" },
    }));
    expect(byId(rows, "accounts.mfa")).toMatchObject({ status: "warn", evidence: { enrolled: 1, admins: 2 } });
    expect(byId(rows, "accounts.apiKeys")).toMatchObject({ status: "warn", summary: "openEnded" });
    expect(byId(rows, "runtime.update").status).toBe("warn");
  });

  it("hides installation proxy and update details from another site", () => {
    const rows = evaluateSecurityCenter(facts({
      installationRoot: false,
      proxy: null,
      update: { state: "available", latest: "9.9.9", checkedAt: "2026-10-29T08:00:00.000Z" },
    }));
    expect(byId(rows, "transport.proxy")).toMatchObject({ status: "not_applicable", summary: "otherSite", evidence: {} });
    expect(byId(rows, "runtime.update")).toMatchObject({ status: "not_applicable", summary: "otherSite", href: null });
    expect(byId(rows, "runtime.update").evidence).not.toHaveProperty("latest");
  });

  it("treats production HTTP as a failed configuration and does not call an unread certificate a pass", () => {
    const http = evaluateSecurityCenter(facts({ appUrl: "http", cookieSecure: true }));
    expect(byId(http, "transport.tls")).toMatchObject({ status: "fail", summary: "productionHttp", kind: "configuration" });
    expect(byId(http, "transport.cookies").status).toBe("pass");

    const dev = evaluateSecurityCenter(facts({
      production: false,
      appUrl: "http",
      cookieSecure: false,
      debugEnabled: true,
      proxy: { mode: "disabled", value: "false" },
    }));
    expect(byId(dev, "transport.tls").status).toBe("not_applicable");
    expect(byId(dev, "transport.cookies").status).toBe("not_applicable");
    expect(byId(dev, "runtime.debug").status).toBe("not_applicable");
    expect(byId(dev, "transport.proxy").status).toBe("not_applicable");
  });

  it("strips control characters from a proxy value before it is shown", () => {
    const rows = evaluateSecurityCenter(facts({
      proxy: { mode: "bounded", value: "loopback\nadmin" },
    }));
    expect(byId(rows, "transport.proxy").evidence.value).toBe("loopbackadmin");
  });
});
