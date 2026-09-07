import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@components/SessionProvider";
import { I18nProvider } from "../../i18n/I18nProvider";
import ThemeCustomizePage from "../admin/ThemeCustomizePage";

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

function mockFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/api/auth/me")) {
        return jsonResponse({ id: "u1", email: "admin@example.com", role: "administrator" });
      }
      if (path.includes("/api/themes/customize")) {
        return jsonResponse({ theme: { name: "Default" }, schema: {}, mods: {}, pages: [] });
      }
      if (path.includes("/api/template-parts/footer")) return jsonResponse({ blocks: [] });
      if (path.includes("/api/languages/active")) return jsonResponse({ languages: [{ code: "en-US", isDefault: true }] });
      if (path.includes("/api/languages")) {
        return jsonResponse({ languages: [{ code: "en-US", isDefault: true, isActive: true }] });
      }
      if (path.includes("/api/menus/design-presets")) return jsonResponse({ presets: [] });
      if (path === "/api/menus") {
        return jsonResponse({ menus: [{ id: "m1", slug: "primary", name: "Primary", items: [] }] });
      }
      if (path.startsWith("/api/menus/")) {
        return jsonResponse({ menu: { id: "m1", slug: "primary", name: "Primary", items: [] } });
      }
      if (path.includes("/api/content-types")) return jsonResponse({ types: [] });
      if (path.includes("/api/content")) return jsonResponse({ items: [] });
      return jsonResponse({});
    }),
  );
}

function renderPage(initialPath = "/admin/themes/customize") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <I18nProvider>
        <SessionProvider>
          <ThemeCustomizePage />
        </SessionProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("ThemeCustomizePage menus tab", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hosts the menu designer under a Menus tab instead of a separate page", async () => {
    mockFetch();
    const user = userEvent.setup();
    renderPage();

    const menusTab = await screen.findByRole("button", { name: "Menus" });
    await user.click(menusTab);
    expect(menusTab.className).toContain("jf-theme-builder__tab--active");
    expect(await screen.findByText("Add menu items")).toBeInTheDocument();
    // Embedded in the customizer, the standalone page's own "back" link is redundant.
    expect(screen.queryByRole("link", { name: /back to themes/i })).not.toBeInTheDocument();
  });

  it("opens directly on the Menus tab when linked with ?tab=menus", async () => {
    mockFetch();
    renderPage("/admin/themes/customize?tab=menus");

    expect(await screen.findByText("Add menu items")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Menus" }).className).toContain(
      "jf-theme-builder__tab--active",
    );
  });
});
