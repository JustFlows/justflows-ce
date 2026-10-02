// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteDb } from "./sqlite-db.js";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";

const state = vi.hoisted(() => ({ db: null as unknown, allowPrivate: false }));
vi.mock("../../../src/lib/database/db.js", () => ({ getDb: async () => state.db }));
vi.mock("../../../src/lib/ai/ai-settings.js", () => ({ allowPrivateAiEndpoints: async () => state.allowPrivate }));

const credentials = await import("../../../src/lib/ai/provider-credentials.js");

const SITE = "site-1";
const KEY = "sk-ant-api03-SECRETSECRETSECRET-abcd";

beforeEach(() => {
  state.db = createSqliteDb();
  state.allowPrivate = false;
});

function rawRows() {
  return (state.db as ReturnType<typeof createSqliteDb>).query<Record<string, unknown>>("SELECT * FROM ai_provider_credentials");
}

describe("provider credentials", () => {
  it("stores the key encrypted and never returns it from a listing", async () => {
    const { credential } = await credentials.saveCredential({
      siteId: SITE,
      scope: { kind: "site" },
      provider: "anthropic",
      apiKey: KEY,
      actorId: "admin",
    });
    expect(credential.keyLast4).toBe("abcd");
    expect(JSON.stringify(credential)).not.toContain("SECRET");

    const [row] = await rawRows();
    expect(String(row!.api_key_enc)).toMatch(/^enc:v1:/);
    expect(String(row!.api_key_enc)).not.toContain("SECRET");

    const listed = await credentials.listCredentials(SITE, { kind: "site" });
    expect(JSON.stringify(listed)).not.toContain("SECRET");
    expect(JSON.stringify(listed)).not.toContain("enc:v1");

    // Only the server-side loader decrypts it.
    const config = await credentials.loadProviderConfig(SITE, { kind: "site" }, "anthropic");
    expect(config?.apiKey).toBe(KEY);
  });

  it("keeps the stored key when a save omits it", async () => {
    await credentials.saveCredential({ siteId: SITE, scope: { kind: "site" }, provider: "openai", apiKey: "sk-proj-old-key-1234", actorId: "a" });
    await credentials.saveCredential({ siteId: SITE, scope: { kind: "site" }, provider: "openai", defaultModel: "gpt-5", actorId: "a" });
    expect((await credentials.loadProviderConfig(SITE, { kind: "site" }, "openai"))?.apiKey).toBe("sk-proj-old-key-1234");
  });

  it("requires a key for a new credential and a base URL for OpenAI-compatible", async () => {
    await expect(
      credentials.saveCredential({ siteId: SITE, scope: { kind: "site" }, provider: "openai", actorId: "a" }),
    ).rejects.toThrow(/API key is required/);
    await expect(
      credentials.saveCredential({ siteId: SITE, scope: { kind: "site" }, provider: "openai-compatible", apiKey: "key-12345678", actorId: "a" }),
    ).rejects.toThrow(/needs a base URL/);
  });

  it("allows a private base URL only for site keys, and only when the setting is on", async () => {
    const local = { provider: "openai-compatible" as const, apiKey: "ollama-local-key", baseUrl: "http://localhost:11434/v1", actorId: "a" };
    await expect(credentials.saveCredential({ siteId: SITE, scope: { kind: "site" }, ...local })).rejects.toThrow(/Base URL: .*allowed/);
    state.allowPrivate = true;
    await expect(credentials.saveCredential({ siteId: SITE, scope: { kind: "site" }, ...local })).resolves.toBeTruthy();
    await expect(credentials.saveCredential({ siteId: SITE, scope: { kind: "user", userId: "u1" }, ...local })).rejects.toThrow(/Base URL: .*allowed/);
  });

  it("prefers a personal key over the site key for its owner only", async () => {
    await credentials.saveCredential({ siteId: SITE, scope: { kind: "site" }, provider: "anthropic", apiKey: "site-key-0001", actorId: "a" });
    await credentials.saveCredential({ siteId: SITE, scope: { kind: "user", userId: "u1" }, provider: "anthropic", apiKey: "mine-key-0002", actorId: "u1" });
    expect((await credentials.availableProviders(SITE, "u1"))[0]).toMatchObject({ provider: "anthropic", source: "personal" });
    expect((await credentials.availableProviders(SITE, "u2"))[0]).toMatchObject({ provider: "anthropic", source: "site" });
  });
});
