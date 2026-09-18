import { I18nProvider } from "../../../../src/i18n/I18nProvider";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ContentListPage from "../../../../src/pages/admin/content/ContentListPage";
import { setAdminSsrPayload } from "../../../../src/ssr-data";

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

const HOME_EN = {
  id: "page-home-en",
  title: "Home",
  slug: "home",
  type: "page",
  locale: "en-US",
  status: "published",
  updatedAt: "2026-08-27T00:00:00.000Z",
};
const HOME_NL = {
  id: "page-home-nl",
  title: "Home",
  slug: "home",
  type: "page",
  locale: "nl-NL",
  status: "published",
  updatedAt: "2026-08-27T00:00:00.000Z",
};
const ABOUT = {
  id: "page-about",
  title: "About us",
  slug: "about-us",
  type: "page",
  locale: "en-US",
  status: "published",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

function mockFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/languages") {
      return jsonResponse({
        languages: [
          { code: "en-US", isDefault: true },
          { code: "nl-NL", isDefault: false },
        ],
      });
    }
    if (path.startsWith("/api/content?" ) || path === "/api/content") {
      // The admin content list spans every language, regardless of the
      // site's default published locale (see ContentListPage.tsx).
      return jsonResponse({ items: [ABOUT, HOME_EN, HOME_NL] });
    }
    if (path === "/api/content-types") {
      return jsonResponse({
        types: [
          { slug: "post", label: "Post" },
          { slug: "page", label: "Page" },
        ],
      });
    }
    if (path === "/api/settings") {
      return jsonResponse({ home_page_id: HOME_EN.id, blog_page_id: null });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ContentListPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAdminSsrPayload(null);
  });

  it("renders content links with the configured admin URL for opening in a new tab", async () => {
    mockFetch();
    setAdminSsrPayload({ adminBasePath: "/admin-test", url: "/admin-test/content", locale: "en", responses: {} });
    render(<MemoryRouter initialEntries={["/admin-test/content"]}><I18nProvider><ContentListPage /></I18nProvider></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "About us" })).toHaveAttribute("href", "/admin-test/content/page-about");
    // Both language versions of "Home" are listed (see the next test), so
    // pick out the English one by href rather than assuming a single match.
    const homeLinks = screen.getAllByRole("link", { name: "Home" });
    const homeEnLink = homeLinks.find((el) => el.getAttribute("href") === "/admin-test/content/page-home-en");
    expect(homeEnLink).toBeTruthy();
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toMatch(/^\/admin(?:\/|\?|#|$)/);
    }
  });

  it("lists items across all languages by default", async () => {
    const fetchMock = mockFetch();
    render(
      <MemoryRouter>
        <I18nProvider><ContentListPage /></I18nProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: "About us" })).toBeInTheDocument();
    // Both the en-US and nl-NL "Home" pages show up — the default published
    // locale only governs public rendering, not what admins can manage.
    expect(screen.getAllByRole("link", { name: "Home" })).toHaveLength(2);

    const contentCalls = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((path) => path === "/api/content" || path.startsWith("/api/content?"));
    expect(contentCalls.some((path) => path === "/api/content")).toBe(true);
    expect(contentCalls.some((path) => path.includes("locale="))).toBe(false);
  });
});
