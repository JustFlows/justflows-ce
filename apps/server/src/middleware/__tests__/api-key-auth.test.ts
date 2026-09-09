// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";

const auditEntries: Record<string, unknown>[] = [];
let manageEnabled = true;

interface FakeVerified {
  record: {
    id: string;
    allowedIps: string[];
    allowedOrigins: string[];
    rateLimitPerMin: number | null;
    scope: Record<string, unknown>;
  };
  owner: { userId: string; siteId: string; role: string };
  rejection: "revoked" | "expired" | null;
}

let verifyResult: FakeVerified | null = {
  record: { id: "key-1", allowedIps: [], allowedOrigins: [], rateLimitPerMin: null, scope: {} },
  owner: { userId: "u1", siteId: "s1", role: "administrator" },
  rejection: null,
};

vi.mock("../../lib/api-keys.js", () => ({
  verifyApiKey: async (secret: string) => (secret === "jfk_good" ? verifyResult : null),
  recordApiKeyUse: vi.fn(async () => undefined),
}));
vi.mock("../../lib/manage-api-settings.js", () => ({
  isManageApiEnabled: async () => manageEnabled,
}));
vi.mock("../../lib/audit-log.js", () => ({
  auditLog: async (entry: Record<string, unknown>) => {
    auditEntries.push(entry);
  },
}));

const { apiKeyAuth } = await import("../api-key-auth.js");

let server: Server;
let url: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/manage/v1", apiKeyAuth, (req, res) => {
    res.json({ ok: true, keyId: req.apiKey?.id, owner: req.apiKeyOwner, role: req.session?.role });
  });
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/manage/v1/thing`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  auditEntries.length = 0;
  manageEnabled = true;
  verifyResult = {
    record: { id: "key-1", allowedIps: [], allowedOrigins: [], rateLimitPerMin: null, scope: {} },
    owner: { userId: "u1", siteId: "s1", role: "administrator" },
    rejection: null,
  };
});

describe("apiKeyAuth", () => {
  it("rejects a request with no bearer token generically", async () => {
    const res = await fetch(url);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(auditEntries.at(-1)?.action).toBe("apikey.auth_failed");
  });

  it("rejects an unknown key without disclosing that it is unknown", async () => {
    const res = await fetch(url, { headers: { authorization: "Bearer jfk_nope" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("accepts a good key and attaches a synthetic api-key session", async () => {
    const res = await fetch(url, { headers: { authorization: "Bearer jfk_good" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      keyId: "key-1",
      owner: { userId: "u1", siteId: "s1", role: "administrator" },
      role: "api-key",
    });
  });

  it("refuses a revoked key and audits it against the key id, never the secret", async () => {
    verifyResult = { ...verifyResult!, rejection: "revoked" };
    const res = await fetch(url, { headers: { authorization: "Bearer jfk_good" } });
    expect(res.status).toBe(401);
    const entry = auditEntries.at(-1)!;
    expect(entry.target).toBe("key-1");
    expect(JSON.stringify(entry)).not.toContain("jfk_good");
  });

  it("refuses every key when the global switch is off", async () => {
    manageEnabled = false;
    const res = await fetch(url, { headers: { authorization: "Bearer jfk_good" } });
    expect(res.status).toBe(401);
  });

  it("enforces the key's allowed-IP list", async () => {
    verifyResult = { ...verifyResult!, record: { ...verifyResult!.record, allowedIps: ["10.0.0.9"] } };
    const res = await fetch(url, { headers: { authorization: "Bearer jfk_good" } });
    expect(res.status).toBe(401);
  });

  it("enforces the key's allowed-origin list for browser callers", async () => {
    verifyResult = {
      ...verifyResult!,
      record: { ...verifyResult!.record, allowedOrigins: ["https://app.example"] },
    };
    const blocked = await fetch(url, {
      headers: { authorization: "Bearer jfk_good", origin: "https://evil.example" },
    });
    expect(blocked.status).toBe(401);
    const allowed = await fetch(url, {
      headers: { authorization: "Bearer jfk_good", origin: "https://app.example" },
    });
    expect(allowed.status).toBe(200);
  });
});
