import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ApiKeysPage from "../../../../src/pages/admin/settings/ApiKeysPage";

vi.mock("../../../../src/i18n/I18nProvider", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

const calls: { url: string; method: string; body: unknown }[] = [];
let manageEnabled = false;

beforeEach(() => {
  calls.length = 0;
  manageEnabled = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/api/api-keys") && method === "GET") {
        return new Response(
          JSON.stringify({
            keys: [
              {
                id: "k1",
                name: "CI",
                keyPrefix: "jfk_abcd1234",
                capabilities: ["content:read"],
                scope: {},
                allowedIps: [],
                allowedOrigins: [],
                rateLimitPerMin: null,
                expiresAt: null,
                revokedAt: null,
                lastUsedAt: null,
                requestCount: 5,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/capabilities")) {
        return new Response(
          JSON.stringify({ capabilities: ["content:read", "content:create", "media:read"] }),
          { status: 200 },
        );
      }
      if (url.endsWith("/api/api-keys/settings") && method === "GET") {
        return new Response(
          JSON.stringify({
            publicApiEnabled: false,
            enabled: manageEnabled,
            rateLimitPerMin: 120,
            allowedOrigins: [],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/api/ai/settings") && method === "GET") {
        return new Response(
          JSON.stringify({
            mcpEnabled: true,
            assistantEnabled: false,
            allowPrivateEndpoints: false,
            userDailyLimit: null,
            mcpRateLimit: null,
            mcpUrl: "http://localhost:3000/api/mcp",
            origin: "http://localhost:3000",
            publicHttps: false,
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/oauth/grants")) {
        return new Response(
          JSON.stringify({
            grants: [
              {
                id: "g1",
                clientId: "jfc_x",
                clientName: "Claude",
                userId: "u1",
                userEmail: "a@example.com",
                userName: "Ada",
                capabilities: ["content:read"],
                userTools: false,
                createdAt: "2026-10-01T10:00:00.000Z",
                lastUsedAt: null,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/api/api-keys") && method === "POST") {
        return new Response(JSON.stringify({ key: "jfk_secret_shown_once", record: {} }), {
          status: 201,
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );
});

describe("ApiKeysPage", () => {
  it("lists existing keys with prefix and usage", async () => {
    render(<ApiKeysPage />);
    await screen.findByRole("heading", { name: "apiKeys.title" });
    expect(screen.getByText("CI")).toBeInTheDocument();
    expect(screen.getByText(/jfk_abcd1234/)).toBeInTheDocument();
  });

  it("creates a scoped key and reveals the secret once", async () => {
    const user = userEvent.setup();
    render(<ApiKeysPage />);
    await screen.findByRole("heading", { name: "apiKeys.title" });

    await user.type(screen.getByLabelText("apiKeys.name"), "Reader");
    await user.click(screen.getByText("apiKeys.chooseCapabilities"));
    await user.click(screen.getByRole("checkbox", { name: "content:read" }));
    await user.click(screen.getByRole("button", { name: "apiKeys.add" }));

    await waitFor(() => expect(screen.getByText("jfk_secret_shown_once")).toBeInTheDocument());
    const post = calls.find((c) => c.url.endsWith("/api/api-keys") && c.method === "POST");
    expect(post?.body).toMatchObject({ name: "Reader", capabilities: ["content:read"] });
  });

  it("does not submit without a capability selected", async () => {
    const user = userEvent.setup();
    render(<ApiKeysPage />);
    await screen.findByRole("heading", { name: "apiKeys.title" });
    await user.type(screen.getByLabelText("apiKeys.name"), "Empty");
    expect(screen.getByRole("button", { name: "apiKeys.add" })).toBeDisabled();
  });

  it("shows the MCP URL and warns about non-public HTTPS", async () => {
    const user = userEvent.setup();
    render(<ApiKeysPage />);
    expect(await screen.findByDisplayValue("http://localhost:3000/api/mcp")).toBeInTheDocument();
    expect(screen.getByText("ai.connect.httpsTitle")).toBeInTheDocument();
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    // MCP needs the management API too: until it is on, no key can be made here.
    expect(screen.getByRole("button", { name: "ai.connect.createKey" })).toBeDisabled();
    expect(screen.getByText("ai.connect.needsManageApi")).toBeInTheDocument();
  });

  it("creates a preset key for the chosen client once MCP and the management API are on", async () => {
    manageEnabled = true;
    const user = userEvent.setup();
    render(<ApiKeysPage />);
    await screen.findByDisplayValue("http://localhost:3000/api/mcp");
    await waitFor(() => expect(screen.getByRole("button", { name: "ai.connect.createKey" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "ai.connect.createKey" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/api/api-keys") && c.method === "POST")).toBe(true));
    const created = calls.find((c) => c.url.endsWith("/api/api-keys") && c.method === "POST")!.body as {
      name: string;
      capabilities: string[];
    };
    // Content editor preset, limited to what this admin can grant.
    expect(created.capabilities).toEqual(["content:read", "content:create", "media:read"]);
    expect(created.name).toMatch(/^Cursor/);
  });

  it("revokes a connected app", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", () => true);
    render(<ApiKeysPage />);
    await screen.findByText("Claude");
    await user.click(screen.getByRole("button", { name: "ai.apps.revoke" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/api/oauth/grants/g1") && c.method === "DELETE")).toBe(true));
  });
});
