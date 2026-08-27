import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@components/SessionProvider";
import SettingsPage from "../admin/SettingsPage";

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

const SETTINGS = {
  site_name: "My Site",
  site_url: "https://example.com",
  admin_email: "admin@example.com",
  default_role: "subscriber",
  site_language: "en",
  languages: [],
  timezone: "UTC",
  timezones: ["UTC"],
  date_format: "F j, Y",
  time_format: "g:i a",
  start_of_week: 1,
  posts_per_page: 10,
  site_public: true,
  public_api_enabled: true,
  discourage_search_engines: false,
};

function mockFetch(role: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/me") return jsonResponse({ id: "self", email: "self@example.com", role });
      if (path === "/api/settings") return jsonResponse(SETTINGS);
      return jsonResponse({});
    }),
  );
}

function renderPage() {
  return render(
    <SessionProvider>
      <SettingsPage />
    </SessionProvider>,
  );
}

describe("SettingsPage as an administrator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows an enabled Save Changes button", async () => {
    mockFetch("administrator");
    renderPage();

    expect(await screen.findByDisplayValue("My Site")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
  });
});

describe("SettingsPage as an editor", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the form read-only, with no Save Changes button", async () => {
    mockFetch("editor");
    renderPage();

    const siteName = await screen.findByDisplayValue("My Site");
    expect(siteName).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
  });
});
