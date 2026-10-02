import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OAuthConsentPage from "../../src/pages/OAuthConsentPage";

vi.mock("../../src/i18n/I18nProvider", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("../../src/lib/csrf", () => ({ ensureCsrfCookie: async () => {} }));

const posts: unknown[] = [];
let consentStatus = 200;

beforeEach(() => {
  posts.length = 0;
  consentStatus = 200;
  window.history.replaceState(null, "", "/oauth/consent?request=signed.request");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        posts.push(JSON.parse(String(init!.body)));
        return new Response(JSON.stringify({ redirectTo: "https://claude.ai/cb?code=x" }), { status: 200 });
      }
      if (consentStatus === 401) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      expect(String(input)).toContain("request=signed.request");
      return new Response(
        JSON.stringify({
          client: { name: "Claude", uri: null, redirectUri: "https://claude.ai/cb" },
          resource: "https://site/api/mcp",
          capabilities: ["content:create", "content:read", "users:manage"],
          canGrantUserTools: true,
          user: { email: "ada@example.com" },
        }),
        { status: 200 },
      );
    }),
  );
});

describe("OAuthConsentPage", () => {
  it("shows the client and its redirect, and sends only the narrowed permissions", async () => {
    const user = userEvent.setup();
    render(<OAuthConsentPage />);
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("https://claude.ai/cb")).toBeInTheDocument();
    // users:manage starts unchecked; uncheck content:create too.
    expect(screen.getByRole("checkbox", { name: "users:manage" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "content:create" }));
    await user.click(screen.getByRole("button", { name: "ai.consent.allow" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ request: "signed.request", approve: true, capabilities: ["content:read"], userTools: false });
  });

  it("sends a denial", async () => {
    const user = userEvent.setup();
    render(<OAuthConsentPage />);
    await screen.findByText("Claude");
    await user.click(screen.getByRole("button", { name: "ai.consent.deny" }));
    await waitFor(() => expect(posts[0]).toMatchObject({ approve: false }));
  });

  it("asks a signed-out user to sign in and come back", async () => {
    consentStatus = 401;
    render(<OAuthConsentPage />);
    const link = await screen.findByRole("link", { name: "ai.consent.signIn" });
    expect(link.getAttribute("href")).toBe(`/login?next=${encodeURIComponent("/oauth/consent?request=signed.request")}`);
  });
});
