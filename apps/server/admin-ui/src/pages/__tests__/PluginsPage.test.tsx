import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginMenuProvider } from "@components/PluginMenuProvider";
import { SessionProvider } from "@components/SessionProvider";
import PluginsPage from "../admin/PluginsPage";

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

const PLUGINS = [
  { id: "seo-kit", name: "SEO Kit", version: "1.0.0", status: "active", publisher: "Justflows" },
];

function mockFetch(role: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/me") return jsonResponse({ id: "self", email: "self@example.com", role });
      if (path === "/api/plugins/admin-menu") return jsonResponse({ items: [] });
      if (path === "/api/plugins") return jsonResponse({ plugins: PLUGINS });
      return jsonResponse({});
    }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <PluginMenuProvider>
          <PluginsPage />
        </PluginMenuProvider>
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("PluginsPage as an administrator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows upload, activate/deactivate, and delete controls", async () => {
    mockFetch("administrator");
    renderPage();

    expect(await screen.findByText("SEO Kit")).toBeInTheDocument();
    expect(screen.getByText("Upload plugin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});

describe("PluginsPage as an editor", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the installed list read-only, with no upload or manage controls", async () => {
    mockFetch("editor");
    renderPage();

    expect(await screen.findByText("SEO Kit")).toBeInTheDocument();
    expect(screen.queryByText("Upload plugin")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});
