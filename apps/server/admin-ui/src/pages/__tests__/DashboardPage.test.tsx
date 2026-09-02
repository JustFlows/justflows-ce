import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@components/SessionProvider";
import { I18nProvider } from "../../i18n/I18nProvider";
import { expectNoCriticalAxe } from "../../test/a11y";
import DashboardPage from "../admin/DashboardPage";

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

type Recorded = { method: string; url: string; body: unknown };

function mockFetch(
  opts: {
    role?: string;
    preferences?: Record<string, unknown>;
    preferencesFails?: boolean;
  } = {},
): { calls: Recorded[] } {
  const calls: Recorded[] = [];
  const role = opts.role ?? "administrator";
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });

      if (url === "/api/auth/me") {
        return jsonResponse({ id: "self", email: "self@example.com", role });
      }
      if (url === "/api/preferences" || url.startsWith("/api/preferences/")) {
        if (opts.preferencesFails) return Promise.reject(new Error("offline"));
        if (method === "GET") return jsonResponse({ preferences: opts.preferences ?? {} });
        return jsonResponse({ ok: true });
      }
      return jsonResponse({});
    }),
  );
  return { calls };
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <I18nProvider>
          <DashboardPage />
        </I18nProvider>
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("DashboardPage welcome panel", () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the discovery panel to an administrator", async () => {
    mockFetch();
    const { container } = renderDashboard();
    const panel = await screen.findByRole("region", { name: "Welcome to JustFlows" });

    const docs = within(panel).getByRole("link", { name: /Documentation/ });
    expect(docs).toHaveAttribute("href", "https://justflows.com/documentation");
    expect(docs).toHaveAttribute("target", "_blank");
    expect(docs).toHaveAttribute("rel", expect.stringContaining("noopener"));

    // The internal Updates card stays an in-app route, not an external link.
    expect(within(panel).getByRole("link", { name: /Updates/ })).toHaveAttribute(
      "href",
      "/admin/updates",
    );

    // No card points at GitHub.
    for (const link of within(panel).getAllByRole("link")) {
      const href = link.getAttribute("href") ?? "";
      const host = /^https?:\/\//.test(href) ? new URL(href).hostname.toLowerCase() : "";
      expect(host === "github.com" || host.endsWith(".github.com")).toBe(false);
    }

    await expectNoCriticalAxe(container);
  });

  it("does not render the panel for an editor", async () => {
    mockFetch({ role: "editor" });
    renderDashboard();
    // The tiles render for every role; the panel must not.
    await screen.findByRole("link", { name: /Content/ });
    expect(screen.queryByRole("region", { name: "Welcome to JustFlows" })).toBeNull();
  });

  it("minimizes and restores the card grid, persisting each change", async () => {
    const { calls } = mockFetch();
    renderDashboard();
    const user = userEvent.setup();

    const panel = await screen.findByRole("region", { name: "Welcome to JustFlows" });
    expect(within(panel).getByRole("link", { name: /Documentation/ })).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Minimize" }));

    expect(within(panel).queryByRole("link", { name: /Documentation/ })).toBeNull();
    const toggle = within(panel).getByRole("button", { name: "Expand" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "PUT" &&
            c.url === "/api/preferences/dashboard_welcome" &&
            (c.body as { collapsed?: boolean }).collapsed === true,
        ),
      ).toBe(true),
    );

    await user.click(toggle);
    expect(within(panel).getByRole("link", { name: /Documentation/ })).toBeInTheDocument();
  });

  it("dismisses the panel and offers a way to bring it back", async () => {
    const { calls } = mockFetch();
    renderDashboard();
    const user = userEvent.setup();

    const panel = await screen.findByRole("region", { name: "Welcome to JustFlows" });
    await user.click(within(panel).getByRole("button", { name: "Dismiss welcome panel" }));

    expect(screen.queryByRole("region", { name: "Welcome to JustFlows" })).toBeNull();
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url === "/api/preferences/dashboard_welcome" &&
            (c.body as { dismissed?: boolean }).dismissed === true,
        ),
      ).toBe(true),
    );

    await user.click(screen.getByRole("button", { name: "Show welcome panel" }));
    expect(await screen.findByRole("region", { name: "Welcome to JustFlows" })).toBeInTheDocument();
  });

  it("keeps Admin Home working when the preferences request fails (offline)", async () => {
    mockFetch({ preferencesFails: true });
    renderDashboard();
    const user = userEvent.setup();

    // Tiles and the panel still render; the failed GET does not block anything.
    expect(await screen.findByRole("link", { name: /^Content/ })).toBeInTheDocument();
    const panel = await screen.findByRole("region", { name: "Welcome to JustFlows" });

    // Dismiss still works in the UI even though the persistence PUT also fails.
    await user.click(within(panel).getByRole("button", { name: "Dismiss welcome panel" }));
    expect(screen.queryByRole("region", { name: "Welcome to JustFlows" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show welcome panel" })).toBeInTheDocument();
  });
});
