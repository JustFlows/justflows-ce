import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@components/SessionProvider";
import { I18nProvider } from "../../i18n/I18nProvider";
import LanguagesPage from "../admin/LanguagesPage";

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

const LANGUAGES = [
  {
    id: "lang-en",
    code: "en-US",
    name: "English",
    nativeName: "English",
    isDefault: true,
    isActive: true,
    sortOrder: 0,
  },
  {
    id: "lang-nl",
    code: "nl-NL",
    name: "Dutch (Netherlands)",
    nativeName: "Nederlands (Nederland)",
    isDefault: false,
    isActive: true,
    sortOrder: 1,
  },
];

function mockFetch(role: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/me") return jsonResponse({ id: "self", email: "self@example.com", role });
      if (path === "/api/languages") return jsonResponse({ languages: LANGUAGES });
      return jsonResponse({});
    }),
  );
}

function renderPage() {
  return render(
    <SessionProvider>
      <I18nProvider>
        <LanguagesPage />
      </I18nProvider>
    </SessionProvider>,
  );
}

describe("LanguagesPage as an administrator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows delete for a non-default language only", async () => {
    mockFetch("administrator");
    renderPage();

    expect(await screen.findByText("nl-NL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
  });
});

describe("LanguagesPage as an editor", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows languages read-only, with no delete control", async () => {
    mockFetch("editor");
    renderPage();

    expect(await screen.findByText("nl-NL")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
  });
});
