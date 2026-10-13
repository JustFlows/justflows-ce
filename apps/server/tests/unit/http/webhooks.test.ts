// SPDX-License-Identifier: MIT
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  active: true,
  run: vi.fn(async (_sql: string, _params: unknown[] = []) => undefined),
  query: vi.fn(async (_sql: string, _params: unknown[] = []) => [] as Record<string, unknown>[]),
  fetch: vi.fn(),
  actions: new Map<string, (payload: unknown, context: Record<string, unknown>) => Promise<void>>(),
  dispatch: vi.fn(async () => undefined),
  enqueue: vi.fn(),
}));
vi.mock("../../../src/lib/database/db.js", () => ({ getDb: async () => ({ run: env.run, query: env.query }) }));
vi.mock("../../../src/lib/tenancy/connections.js", () => ({ eachActiveSite: async (fn: (id: string) => Promise<void>) => { if (env.active) await fn("site-1"); } }));
vi.mock("../../../src/lib/security/pinned-fetch.js", () => ({ pinnedFetch: env.fetch }));
vi.mock("../../../src/lib/security/webhook-url.js", () => ({ validateWebhookUrl: async (url: string) => new URL(url) }));
vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({ getRuntimeHooks: () => ({
  applyFilter: async (hook: string, value: unknown) => hook === "webhook.eventTypes" ? [...value as string[], "justflows.shop.order.paid"] : value,
  dispatchAction: env.dispatch,
  action: (event: string, handler: (payload: unknown, context: Record<string, unknown>) => Promise<void>) => env.actions.set(event, handler),
}) }));
vi.mock("@justflows/jobs", () => ({ JobScheduler: class { enqueue = env.enqueue; register() {} start() {} } }));

import { enqueueWebhookEvent, processDueWebhookDeliveries, refreshWebhookEventHooks, startWebhookJobs } from "../../../src/lib/http/webhooks.js";

const payload = JSON.stringify({ id: "outer-id", event: "justflows.shop.order.paid", createdAt: "2026-10-11T10:00:00Z", data: { version: 1, eventKey: "order.paid:order-1", totalMinor: 1000 } });
const row = { id: "delivery-1", endpoint_id: "endpoint-1", site_id: "site-1", payload, attempt_count: 0, url: "https://receiver.example/events", secret_ciphertext: "test-webhook-secret" };

beforeEach(() => { env.active = true; vi.clearAllMocks(); env.query.mockResolvedValue([]); env.fetch.mockResolvedValue(new Response(null, { status: 204 })); });

describe("commerce webhook delivery contract", () => {
  it("queues only the site's subscriptions and retains the versioned Shop envelope", async () => {
    env.query.mockResolvedValue([{ id: "endpoint-1", site_id: "site-1", events: '["justflows.shop.order.paid"]' }, { id: "endpoint-2", site_id: "site-1", events: '["content.created"]' }]);
    expect(await enqueueWebhookEvent("justflows.shop.order.paid", { version: 1, eventKey: "order.paid:order-1" }, { siteId: "site-1" })).toBe(1);
    expect(env.query.mock.calls[0]).toEqual([expect.stringContaining("WHERE site_id = ?"), ["site-1", true]]);
    const params = env.run.mock.calls[0]![1] as unknown as unknown[];
    expect(params[2]).toBe("site-1");
    expect(JSON.parse(String(params[4]))).toMatchObject({ event: "justflows.shop.order.paid", data: { version: 1, eventKey: "order.paid:order-1" } });
  });

  it("does not deliver suspended workspace webhooks", async () => {
    env.active = false;
    env.query.mockResolvedValue([row]);
    expect(await processDueWebhookDeliveries()).toBe(0);
    expect(env.fetch).not.toHaveBeenCalled();
  });

  it("signs the exact bytes and records a delivered response", async () => {
    env.query.mockResolvedValue([row]);
    expect(await processDueWebhookDeliveries()).toBe(1);
    const call = env.fetch.mock.calls[0]![1] as RequestInit;
    const headers = call.headers as Record<string, string>;
    const digest = createHmac("sha256", "test-webhook-secret").update(`${headers["x-justflows-timestamp"]}.${payload}`).digest("hex");
    expect(headers["x-justflows-signature"]).toBe(`sha256=${digest}`);
    expect(headers["x-justflows-delivery"]).toBe("delivery-1");
    expect(call.body).toBe(payload);
    expect(call.redirect).toBe("manual");
    expect(env.run.mock.calls.some(([sql]) => String(sql).includes("status = 'delivered'"))).toBe(true);
  });

  it("retries receiver failures and records the fifth attempt as terminal", async () => {
    env.fetch.mockImplementation(async () => new Response("temporarily unavailable", { status: 503 }));
    env.query.mockResolvedValue([row]);
    await processDueWebhookDeliveries();
    expect(env.run.mock.calls.some(([sql, params]) => String(sql).includes("next_attempt_at = ?") && (params as unknown as unknown[])[0] === "pending")).toBe(true);
    env.run.mockClear();
    env.query.mockResolvedValue([{ ...row, attempt_count: 4 }]);
    await processDueWebhookDeliveries();
    expect(env.run.mock.calls.some(([sql, params]) => String(sql).includes("next_attempt_at = ?") && (params as unknown as unknown[])[0] === "failed")).toBe(true);
  });

  it("recovers interrupted claims and avoids queuing a durable action twice", async () => {
    await startWebhookJobs();
    expect(env.run.mock.calls.some(([sql]) => String(sql).includes("WHERE status = 'processing'"))).toBe(true);
    await refreshWebhookEventHooks();
    env.query.mockClear();
    await env.actions.get("justflows.shop.order.paid")!({ version: 1 }, { siteId: "site-1", webhookQueued: true });
    expect(env.query).not.toHaveBeenCalled();
  });
});
