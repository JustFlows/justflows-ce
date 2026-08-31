import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isBlockedWebhookAddress, validateWebhookUrl } from "../webhook-url.js";
import { createWebhookSecret, signWebhookPayload } from "../webhooks.js";

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
  ])("blocks private address %s", (address) => expect(isBlockedWebhookAddress(address)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows public address %s", (address) =>
    expect(isBlockedWebhookAddress(address)).toBe(false),
  );

  it("rejects local, credential-bearing, and custom-port URLs", async () => {
    await expect(validateWebhookUrl("http://localhost/hook")).rejects.toThrow("Private");
    await expect(validateWebhookUrl("https://user:pass@example.com/hook")).rejects.toThrow(
      "credentials",
    );
    await expect(validateWebhookUrl("https://example.com:8443/hook")).rejects.toThrow("port");
  });
});

describe("webhook signatures", () => {
  it("creates opaque secrets and signs timestamp plus raw body", () => {
    const secret = createWebhookSecret();
    const timestamp = "1788177600";
    const body = '{"event":"content.published"}';
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(signWebhookPayload(secret, timestamp, body)).toBe(
      createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"),
    );
  });
});
