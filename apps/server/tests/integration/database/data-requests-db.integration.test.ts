// SPDX-License-Identifier: MIT
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedAccountPage } from "@justflows/content";
import { getDb } from "../../../src/lib/database/db.js";
import { runAllMigrations, type DbDriver } from "../../../src/lib/database/run-migrations.js";

vi.mock("../../../src/lib/email/mail.js", () => ({ sendTemplateMail: async () => ({ ok: true }) }));

process.env.APP_SECRET ||= "integration-test-secret-of-at-least-32-chars";
const { addressConfirmationToken, addressConfirmed, cancelErasureRequest, createErasureRequest, declineErasureRequest, listDataRequests, openErasureRequest, redeemAddressConfirmation, saveSelfServiceSettings, selfServiceSettings } =
  await import("../../../src/lib/auth/data-requests.js");

/**
 * Members' own data requests and the "Your data" page seed on a real
 * database: migration 0059 on every supported driver, dates that survive the
 * round trip, one open request per member, and the seed that leaves edited
 * pages alone.
 *
 *   DATA_REQUESTS_TEST_DATABASE=1 DB_NAME=data_requests_test DB_DRIVER=postgres|mysql|mariadb \
 *   pnpm vitest run tests/integration/database/data-requests-db.integration.test.ts
 */
const enabled = process.env.DATA_REQUESTS_TEST_DATABASE === "1" && process.env.DB_NAME === "data_requests_test";

describe.skipIf(!enabled)("data requests on a real database", () => {
  const siteId = randomUUID();
  const otherSite = randomUUID();
  const userId = randomUUID();
  const admin = { siteId, userId: randomUUID(), role: "administrator" };

  beforeAll(async () => {
    const db = await getDb();
    await runAllMigrations(db, process.env.DB_DRIVER as DbDriver);
    const tenantId = randomUUID();
    await db.run("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, ?, 'active')", [tenantId, `t-${tenantId}`, "Requests"]);
    for (const id of [siteId, otherSite]) await db.run("INSERT INTO sites (id, tenant_id, name, url) VALUES (?, ?, ?, ?)", [id, tenantId, "Requests", `https://${id}.example`]);
    await db.run("INSERT INTO users (id, site_id, email, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?, 'x', 'subscriber')", [userId, siteId, "ada@example.com", `ada-${userId.slice(0, 8)}`, "Ada"]);
  }, 120_000);

  afterAll(async () => {
    await (await getDb()).close();
  });

  it("seeds Your account and Your data once, after each other, and never twice", async () => {
    const db = await getDb();
    await seedAccountPage(db as never, siteId, "en");
    await seedAccountPage(db as never, siteId, "en");
    const pages = await db.query<{ slug: string; created_at: unknown }>("SELECT slug, created_at FROM content WHERE site_id = ? AND type = 'account' ORDER BY created_at, id", [siteId]);
    expect(pages.map((page) => page.slug)).toEqual(["account", "account-data"]);
  });

  it("adds Your data to a site that already has its account page", async () => {
    const db = await getDb();
    await db.run("INSERT INTO content (id, site_id, type, title, slug, locale, status, blocks, fields) VALUES (?, ?, 'account', 'My account', 'my-account', 'en', 'published', '{}', '{}')", [randomUUID(), otherSite]);
    await seedAccountPage(db as never, otherSite, "en");
    const pages = await db.query<{ slug: string }>("SELECT slug FROM content WHERE site_id = ? AND type = 'account' ORDER BY slug", [otherSite]);
    expect(pages.map((page) => page.slug)).toEqual(["account-data", "my-account"]);
  });

  it("stores the site's choices", async () => {
    expect(await selfServiceSettings(siteId)).toEqual({ download: true, erasure: true });
    expect(await saveSelfServiceSettings(siteId, { download: false })).toEqual({ download: false, erasure: true });
    await saveSelfServiceSettings(siteId, { download: true });
  });

  it("asks for the address to be confirmed first, and remembers it", async () => {
    const member = { siteId, userId, email: "ada@example.com" };
    expect(await createErasureRequest(siteId, { ...member, displayName: "Ada" }, null)).toMatchObject({ ok: false, status: 403 });
    expect(await redeemAddressConfirmation(addressConfirmationToken(siteId, userId, member.email), member)).toBe(true);
    expect(await addressConfirmed(userId, member.email)).toBe(true);
  });

  it("keeps one open request per member with its 30-day due date, and lets them withdraw it", async () => {
    const member = { userId, email: "Ada@Example.com", displayName: "Ada" };
    const first = await createErasureRequest(siteId, member, "note");
    expect(first).toMatchObject({ ok: true, created: true });
    const request = (first as { request: { requestedAt: string; dueAt: string } }).request;
    expect(Date.parse(request.dueAt) - Date.parse(request.requestedAt)).toBe(30 * 24 * 60 * 60 * 1000);
    /** Times read back as the instants that were written. */
    expect(Math.abs(Date.parse(request.requestedAt) - Date.now())).toBeLessThan(60_000);
    expect(await createErasureRequest(siteId, member, null)).toMatchObject({ ok: true, created: false });
    expect(await listDataRequests(siteId, "open")).toHaveLength(1);
    expect(await listDataRequests(otherSite, "open")).toEqual([]);
    expect(await cancelErasureRequest(siteId, userId)).toBe(true);
    expect(await openErasureRequest(siteId, userId)).toBeNull();
  });

  it("declines with a reason and forgets the address", async () => {
    const created = await createErasureRequest(siteId, { userId, email: "ada@example.com", displayName: "Ada" }, null);
    const id = (created as { request: { id: string } }).request.id;
    expect(await declineErasureRequest(otherSite, id, { ...admin, siteId: otherSite }, "No")).toMatchObject({ ok: false, status: 404 });
    expect(await declineErasureRequest(siteId, id, admin, "An order is still open.")).toMatchObject({ ok: true, request: { status: "declined", email: "", outcome: "An order is still open." } });
    const handled = await listDataRequests(siteId, "handled");
    expect(handled.map((row) => row.status).sort()).toEqual(["cancelled", "declined"]);
    expect(handled.every((row) => row.email === "" && row.handledAt)).toBe(true);
  });
});
