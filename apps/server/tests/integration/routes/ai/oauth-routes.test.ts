// SPDX-License-Identifier: MIT
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteDb } from "../../../unit/ai/sqlite-db.js";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";
delete process.env.APP_URL;

const state = vi.hoisted(() => ({ db: null as unknown, enabled: true }));
vi.mock("../../../../src/lib/database/db.js", () => ({ getDb: async () => state.db }));
vi.mock("../../../../src/lib/settings/site-settings.js", () => ({ getSiteId: async () => "s1" }));
vi.mock("../../../../src/lib/ai/ai-settings.js", async (orig) => ({
  ...(await orig<typeof import("../../../../src/lib/ai/ai-settings.js")>()),
  isMcpEnabled: async () => state.enabled,
}));
vi.mock("../../../../src/lib/security/audit-log.js", () => ({ auditLog: vi.fn(async () => {}) }));

const { default: oauthRouter } = await import("../../../../src/routes/ai/oauth.js");
const store = await import("../../../../src/lib/ai/oauth/oauth-store.js");

let server: Server;
let origin: string;
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(oauthRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(async () => {
  const db = createSqliteDb();
  await db.run("INSERT INTO users (id, site_id, role, email) VALUES ('u1', 's1', 'editor', 'e@example.com')");
  state.db = db;
  state.enabled = true;
});

async function register(body: Record<string, unknown> = { client_name: "Claude", redirect_uris: [REDIRECT] }) {
  const res = await fetch(`${origin}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, body: (await res.json()) as Record<string, unknown> };
}

function authorizeUrl(params: Record<string, string>) {
  return `${origin}/oauth/authorize?${new URLSearchParams(params).toString()}`;
}

describe("OAuth discovery", () => {
  it("publishes protected resource and authorization server metadata", async () => {
    const pr = (await (await fetch(`${origin}/.well-known/oauth-protected-resource/api/mcp`)).json()) as Record<string, unknown>;
    expect(pr).toMatchObject({ resource: `${origin}/api/mcp`, authorization_servers: [origin] });
    const as = (await (await fetch(`${origin}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(as).toMatchObject({
      issuer: origin,
      code_challenge_methods_supported: ["S256"],
      registration_endpoint: `${origin}/oauth/register`,
      grant_types_supported: ["authorization_code", "refresh_token"],
    });
  });

  it("is 404 while MCP is off", async () => {
    state.enabled = false;
    expect((await fetch(`${origin}/.well-known/oauth-authorization-server`)).status).toBe(404);
    expect((await register()).res.status).toBe(404);
  });
});

describe("dynamic client registration", () => {
  it("registers a public client", async () => {
    const { res, body } = await register();
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ token_endpoint_auth_method: "none", redirect_uris: [REDIRECT] });
    expect(String(body.client_id)).toMatch(/^jfc_/);
    expect(body.client_secret).toBeUndefined();
  });

  it("rejects unsafe redirect URIs and unsupported grant types", async () => {
    expect((await register({ client_name: "x", redirect_uris: ["http://evil.example/cb"] })).res.status).toBe(400);
    expect((await register({ client_name: "x", redirect_uris: [REDIRECT], grant_types: ["client_credentials"] })).res.status).toBe(400);
  });
});

describe("authorization endpoint", () => {
  it("shows an error page (never redirects) for an unregistered redirect_uri", async () => {
    const { body } = await register();
    const res = await fetch(
      authorizeUrl({
        response_type: "code",
        client_id: String(body.client_id),
        redirect_uri: "https://evil.example/cb",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
      }),
      { redirect: "manual" },
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects back with invalid_request when PKCE is missing or not S256", async () => {
    const { body } = await register();
    const res = await fetch(
      authorizeUrl({ response_type: "code", client_id: String(body.client_id), redirect_uri: REDIRECT, code_challenge_method: "plain", code_challenge: "x", state: "st" }),
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get("error")).toBe("invalid_request");
    expect(location.searchParams.get("state")).toBe("st");
  });

  it("rejects a resource other than this server's MCP or management API", async () => {
    const { body } = await register();
    const res = await fetch(
      authorizeUrl({
        response_type: "code",
        client_id: String(body.client_id),
        redirect_uri: REDIRECT,
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
        resource: "https://other.example/api/mcp",
      }),
      { redirect: "manual" },
    );
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_target");
  });

  it("hands a valid request to the consent screen", async () => {
    const { body } = await register();
    const res = await fetch(
      authorizeUrl({ response_type: "code", client_id: String(body.client_id), redirect_uri: REDIRECT, code_challenge: "a".repeat(43), code_challenge_method: "S256" }),
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location.startsWith("/oauth/consent?request=")).toBe(true);
    const signed = new URLSearchParams(location.split("?")[1]).get("request");
    expect(store.verifyAuthorizationRequest(signed)?.resource).toBe(`${origin}/api/mcp`);
  });
});

describe("token endpoint", () => {
  it("exchanges a code with PKCE, then refuses PKCE failure and code reuse", async () => {
    const { body } = await register();
    const client = (await store.getClientByClientId(String(body.client_id)))!;
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const { code } = await store.issueAuthorizationCode({
      siteId: "s1", client, userId: "u1", capabilities: ["content:read"], userTools: false,
      redirectUri: REDIRECT, codeChallenge: challenge, resource: `${origin}/api/mcp`,
    });
    const token = (params: Record<string, string>) =>
      fetch(`${origin}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
      });

    const bad = await token({ grant_type: "authorization_code", client_id: client.clientId, code, redirect_uri: REDIRECT, code_verifier: "x".repeat(43) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_grant" });
    expect(bad.headers.get("cache-control")).toBe("no-store");
  });

  it("issues tokens for a correct exchange", async () => {
    const { body } = await register();
    const client = (await store.getClientByClientId(String(body.client_id)))!;
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const { code } = await store.issueAuthorizationCode({
      siteId: "s1", client, userId: "u1", capabilities: ["content:read"], userTools: false,
      redirectUri: REDIRECT, codeChallenge: challenge, resource: `${origin}/api/mcp`,
    });
    const res = await fetch(`${origin}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.clientId, code, redirect_uri: REDIRECT, code_verifier: verifier }).toString(),
    });
    expect(res.status).toBe(200);
    const tokens = (await res.json()) as Record<string, unknown>;
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    const replay = await fetch(`${origin}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.clientId, code, redirect_uri: REDIRECT, code_verifier: verifier }).toString(),
    });
    expect(replay.status).toBe(400);
  });

  it("refuses grant types other than authorization_code and refresh_token", async () => {
    const { body } = await register();
    const res = await fetch(`${origin}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: String(body.client_id) }).toString(),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unsupported_grant_type" });
  });

  it("answers an unknown client with invalid_client and does not say why", async () => {
    const res = await fetch(`${origin}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", client_id: "jfc_unknown", refresh_token: "jfo_rt_x" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_client", error_description: "Client authentication failed" });
  });

  it("authenticates a confidential client with HTTP Basic credentials", async () => {
    const { body } = await register({ client_name: "Server", redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" });
    expect(typeof body.client_secret).toBe("string");
    const refresh = (authorization: string) =>
      fetch(`${origin}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", authorization },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "jfo_rt_x" }).toString(),
      });
    const basic = (secret: string) =>
      Buffer.from(`${encodeURIComponent(String(body.client_id))}:${encodeURIComponent(secret)}`).toString("base64");

    // Authenticated: the bogus refresh token is the only problem.
    const ok = await refresh(`basic  ${basic(String(body.client_secret))}`);
    expect(await ok.json()).toMatchObject({ error: "invalid_grant" });
    expect((await refresh(`Basic ${basic("wrong")}`)).status).toBe(401);

    // A long run of spaces after the scheme is answered without slow backtracking.
    const started = Date.now();
    expect((await refresh(`Basic ${" ".repeat(10_000)}x`)).status).toBe(401);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("rate-limits the registration endpoint", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) statuses.push((await register()).res.status);
    expect(statuses).toContain(429);
  });
});
