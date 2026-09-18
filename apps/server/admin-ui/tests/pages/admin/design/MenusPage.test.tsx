import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@components/SessionProvider";
import { I18nProvider } from "../../../../src/i18n/I18nProvider";
import MenusPage from "../../../../src/pages/admin/design/MenusPage";

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
};
const HOME_NL = {
  id: "page-home-nl",
  title: "Home",
  slug: "home",
  type: "page",
  locale: "nl-NL",
};
const ABOUT = {
  id: "page-about",
  title: "About us",
  slug: "about-us",
  type: "page",
  locale: "en-US",
};
const MUG = {
  id: "product-mug",
  title: "Ceramic mug",
  slug: "ceramic-mug",
  type: "product",
  locale: "en-US",
};

function mockFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/auth/me") {
      return jsonResponse({ id: "self", email: "self@example.com", role: "administrator" });
    }
    if (path === "/api/languages") {
      return jsonResponse({
        languages: [
          { id: "1", code: "en-US", name: "English", nativeName: "English", isDefault: true, isActive: true },
          { id: "2", code: "nl-NL", name: "Dutch", nativeName: "Nederlands", isDefault: false, isActive: true },
        ],
      });
    }
    if (path === "/api/content-types") {
      return jsonResponse({
        types: [
          { slug: "page", label: "Page" },
          { slug: "post", label: "Post" },
          { slug: "product", label: "Product" },
          { slug: "shop", label: "Shop" },
        ],
      });
    }
    if (path === "/api/menus") {
      return jsonResponse({ menus: [{ id: "m1", slug: "primary", name: "Primary", items: [] }] });
    }
    if (path.startsWith("/api/menus/")) {
      return jsonResponse({ menu: { id: "m1", slug: "primary", name: "Primary", items: [] } });
    }
    if (path.startsWith("/api/content?type=page")) {
      // The "add items" picker spans every language (see MenusPage.tsx).
      return jsonResponse({ items: [ABOUT, HOME_EN, HOME_NL] });
    }
    if (path.startsWith("/api/content?type=post")) {
      return jsonResponse({ items: [] });
    }
    if (path.startsWith("/api/content?type=product")) {
      return jsonResponse({ items: [MUG] });
    }
    if (path.startsWith("/api/content?type=shop")) {
      return jsonResponse({ items: [] });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <I18nProvider>
          <MenusPage />
        </I18nProvider>
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("MenusPage content picker", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists pages from every language when adding menu items", async () => {
    const fetchMock = mockFetch();
    renderPage();

    expect(await screen.findByText("About us")).toBeInTheDocument();
    // Both the en-US and nl-NL "Home" pages are offered — the site's default
    // published locale only governs public rendering, not this picker.
    expect(screen.getAllByText("Home")).toHaveLength(2);

    const pageCalls = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((path) => path.startsWith("/api/content?type=page"));
    expect(pageCalls.some((path) => path.includes("locale="))).toBe(false);
  });

  it("lists other content types such as products in the picker", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    renderPage();

    expect(await screen.findByRole("button", { name: "Products" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shop" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Products" }));
    expect(await screen.findByText("Ceramic mug")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Add to menu" }));
    expect(screen.getByDisplayValue("Ceramic mug")).toBeInTheDocument();
    expect(screen.getByText("Product")).toBeInTheDocument();

    const productCalls = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((path) => path.startsWith("/api/content?type=product"));
    expect(productCalls.some((path) => path.includes("locale="))).toBe(false);
  });
});
