import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isBlockedWebhookAddress, validateWebhookUrl } from "../../../src/lib/security/webhook-url.js";
import {
  CORE_WEBHOOK_EVENTS,
  createWebhookSecret,
  processDueWebhookDeliveries,
  signWebhookPayload,
} from "../../../src/lib/http/webhooks.js";

// Requests go through the connect-time pinned agent in production; route them
// back to the stubbed global fetch here.
vi.mock("../../../src/lib/security/pinned-fetch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/lib/security/pinned-fetch.js")>()),
  pinnedFetch: (url: URL | string, { allowPrivate: _allowPrivate, ...init }: RequestInit & { allowPrivate?: boolean } = {}) =>
    fetch(url, init),
}));


const db = vi.hoisted(() => ({ query: vi.fn(), run: vi.fn() }));
vi.mock("../../../src/lib/database/db.js", () => ({ getDb: async () => db }));

afterEach(() => {
  vi.restoreAllMocks();
  db.query.mockReset();
  db.run.mockReset();
});

describe("webhook endpoint safety", () => {
  it.each([
    "127.0.0.1",
    "10.2.3.4",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fd00::1",
    "fe80::1",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:7f00:0001",
    "::ffff:a00:1",
    "::ffff:c0a8:101",
    "::ffff:a9fe:a9fe",
    "64:ff9b::7f00:1",
    "64:ff9b:1::1",
    "2002:7f00:1::",
    "2001::1",
    "fec0::1",
    "ff02::1",
    "198.18.0.1",
  ])("blocks private address %s", (address) => expect(isBlockedWebhookAddress(address)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:808:808", "64:ff9b::808:808"])("allows public address %s", (address) =>
    expect(isBlockedWebhookAddress(address)).toBe(false),
  );

  it("rejects local, credential-bearing, and custom-port URLs", async () => {
    await expect(validateWebhookUrl("http://localhost/hook")).rejects.toThrow("Private");
    await expect(validateWebhookUrl("https://user:pass@example.com/hook")).rejects.toThrow(
      "credentials",
    );
    await expect(validateWebhookUrl("https://example.com:8443/hook")).rejects.toThrow("port");
  });

  it("rejects IPv4-mapped IPv6 literals in every textual form", async () => {
    for (const host of ["[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "[0:0:0:0:0:ffff:a00:1]"]) {
      await expect(validateWebhookUrl(`http://${host}/hook`)).rejects.toThrow("Private");
    }
  });
});

describe("webhook signatures", () => {
  it("offers user, plugin, theme, authentication, and core-update lifecycle events", () => {
    expect(CORE_WEBHOOK_EVENTS).toEqual(
      expect.arrayContaining([
        "user.created",
        "user.updated",
        "user.deleted",
        "auth.login",
        "auth.logout",
        "plugin.installed",
        "plugin.activated",
        "plugin.deactivated",
        "plugin.uninstalled",
        "theme.installed",
        "theme.activated",
        "core.updated",
      ]),
    );
  });
  it("creates opaque secrets and signs timestamp plus raw body", () => {
    const secret = createWebhookSecret();
    const timestamp = "1788177600";
    const body = '{"event":"content.published"}';
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(signWebhookPayload(secret, timestamp, body)).toBe(
      createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"),
    );
  });

  it("sends a verifiably signed payload to the endpoint", async () => {
    const payload = JSON.stringify({
      id: "event-1",
      event: "content.published",
      createdAt: "2026-08-31T12:00:00.000Z",
      data: { contentId: "page-1", siteId: "site-1" },
    });
    const secret = "whsec_test_receiver_secret";
    db.query.mockResolvedValue([
      {
        id: "delivery-1",
        endpoint_id: "endpoint-1",
        payload,
        attempt_count: 0,
        url: "https://8.8.8.8/hook",
        secret_ciphertext: secret,
      },
    ]);
    const receiver = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("accepted", { status: 202 }));

    await expect(processDueWebhookDeliveries()).resolves.toBe(1);

    const [url, request] = receiver.mock.calls[0]!;
    const headers = new Headers(request?.headers);
    expect(String(url)).toBe("https://8.8.8.8/hook");
    expect(request?.body).toBe(payload);
    expect(headers.get("x-justflows-delivery")).toBe("delivery-1");
    const timestamp = headers.get("x-justflows-timestamp")!;
    expect(headers.get("x-justflows-signature")).toBe(
      `sha256=${signWebhookPayload(secret, timestamp, payload)}`,
    );
    expect(db.run).toHaveBeenLastCalledWith(
      expect.stringContaining("status = 'delivered'"),
      expect.arrayContaining([202, "accepted"]),
    );
  });

  it("stores only a bounded prefix of an endless response body", async () => {
    db.query.mockResolvedValue([
      {
        id: "delivery-2",
        endpoint_id: "endpoint-1",
        payload: "{}",
        attempt_count: 0,
        url: "https://8.8.8.8/hook",
        secret_ciphertext: "whsec_test",
      },
    ]);
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024).fill(120));
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(endless, { status: 200 }));

    await expect(processDueWebhookDeliveries()).resolves.toBe(1);

    const stored = db.run.mock.calls.at(-1)![1] as unknown[];
    expect(stored[1]).toHaveLength(2048);
    expect(pulled).toBeLessThan(10);
  });
});
