import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ApiKeysPage from "../admin/ApiKeysPage";

vi.mock("../../i18n/I18nProvider", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

const calls: { url: string; method: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
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
      if (url.endsWith("/settings") && method === "GET") {
        return new Response(
          JSON.stringify({
            publicApiEnabled: false,
            enabled: false,
            rateLimitPerMin: 120,
            allowedOrigins: [],
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
});
