import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  metadata: "{}",
  deliveries: 0,
  enabled: true,
  adminEmail: "security@example.com",
  sent: [] as Array<Record<string, unknown>>,
  sendOk: true,
  isRoot: false,
  networkEnabled: false,
}));

vi.mock("../../../src/lib/settings/site-settings.js", () => ({
  getSiteSetting: vi.fn(async (siteId: string) => siteId === "root"
    ? { enabled: false, networkEnabled: state.networkEnabled }
    : { enabled: state.enabled }),
  setSiteSetting: vi.fn(async () => undefined),
}));

vi.mock("../../../src/lib/settings/general-settings.js", () => ({
  getGeneralSettings: vi.fn(async (siteId: string) => ({
    adminEmail: siteId === "root" ? "network@example.com" : state.adminEmail,
  })),
}));

vi.mock("../../../src/lib/tenancy/registry.js", () => ({
  isInstallationRootSite: vi.fn(async () => state.isRoot),
  installationRootSiteId: vi.fn(async () => "root"),
}));

vi.mock("../../../src/lib/tenancy/provision.js", () => ({
  runWithSiteDatabase: vi.fn(async (_siteId: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../../../src/lib/email/mail.js", () => ({
  sendMail: vi.fn(async (message: Record<string, unknown>) => {
    state.sent.push(message);
    return state.sendOk ? { ok: true, response: "accepted" } : { ok: false, error: "unavailable" };
  }),
}));

vi.mock("../../../src/lib/database/db.js", () => ({
  getDb: async () => ({
    run: async (sql: string, params: unknown[]) => {
      if (/UPDATE audit_log SET metadata/i.test(sql) && /metadata = '\{\}'/i.test(sql)) {
        if (state.metadata === "{}") state.metadata = String(params[0]);
      } else if (/UPDATE audit_log SET metadata/i.test(sql)) {
        state.metadata = String(params[0]);
      }
    },
    query: async (sql: string) => {
      if (/SELECT metadata FROM audit_log/i.test(sql)) return [{ metadata: state.metadata }];
      if (/FROM email_deliveries/i.test(sql)) return [{ total: state.deliveries }];
      if (/SELECT url FROM sites/i.test(sql)) return [{ url: "https://site.example.test" }];
      return [];
    },
  }),
}));

const { getSecurityNotificationStatus, notifySecurityEvent } = await import(
  "../../../src/lib/security/security-notifications.js"
);

beforeEach(() => {
  state.metadata = "{}";
  state.deliveries = 0;
  state.enabled = true;
  state.adminEmail = "security@example.com";
  state.sent = [];
  state.sendOk = true;
  state.isRoot = false;
  state.networkEnabled = false;
});

describe("security notifications", () => {
  it("is opt-in and exposes only a masked recipient", async () => {
    expect(await getSecurityNotificationStatus("site-1")).toEqual({
      enabled: true,
      available: true,
      recipient: "s***@example.com",
      canManageNetwork: false,
      networkEnabled: false,
    });
  });

  it("delivers one redacted summary for a high-value event", async () => {
    const event = {
      id: "event-1",
      siteId: "site-1",
      action: "integrity.failed" as const,
      occurredAt: "2026-11-04 09:00:00",
    };
    await notifySecurityEvent(event);
    await notifySecurityEvent(event);

    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({
      to: "security@example.com",
      type: "security-event",
    });
    expect(String(state.sent[0]?.text)).toContain("integrity.failed");
    expect(String(state.sent[0]?.text)).toContain("https://site.example.test/admin/security/audit?view=security");
    expect(String(state.sent[0]?.text)).not.toContain("token");
    expect(state.metadata).toContain('"status":"sent"');
  });

  it("records a failed delivery without exposing the mail error in the event", async () => {
    state.sendOk = false;
    await notifySecurityEvent({
      id: "event-1",
      siteId: "site-1",
      action: "core.auto_update_failed",
      occurredAt: "2026-11-04 09:00:00",
    });

    expect(state.sent).toHaveLength(1);
    expect(state.metadata).toContain('"status":"failed"');
    expect(state.metadata).not.toContain("unavailable");
  });

  it("adds the installation recipient when the network policy is enabled", async () => {
    state.networkEnabled = true;
    await notifySecurityEvent({
      id: "event-1",
      siteId: "site-1",
      action: "user.role_changed",
      occurredAt: "2026-11-04 09:00:00",
    });

    expect(state.sent.map((message) => message.to)).toEqual([
      "security@example.com",
      "network@example.com",
    ]);
  });

  it("does not notify for ordinary content activity or after the hourly cap", async () => {
    await notifySecurityEvent({
      id: "event-1",
      siteId: "site-1",
      action: "content.published",
      occurredAt: "2026-11-04 09:00:00",
    });
    state.deliveries = 10;
    await notifySecurityEvent({
      id: "event-2",
      siteId: "site-1",
      action: "auth.login_failed",
      occurredAt: "2026-11-04 09:01:00",
    });

    expect(state.sent).toHaveLength(0);
    expect(state.metadata).toContain('"status":"rate_limited"');
  });
});
