import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@components/SessionProvider";
import ContentTypesPage from "../admin/ContentTypesPage";

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

const TYPES = [
  {
    slug: "product",
    label: "Product",
    description: "",
    builtin: false,
    fields: [{ key: "price", label: "Price", type: "number", required: false }],
  },
];

function mockFetch(role: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/me") return jsonResponse({ id: "self", email: "self@example.com", role });
      if (path === "/api/content-types") return jsonResponse({ types: TYPES });
      return jsonResponse({});
    }),
  );
}

function renderPage() {
  return render(
    <SessionProvider>
      <ContentTypesPage />
    </SessionProvider>,
  );
}

describe("ContentTypesPage as an administrator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows create, edit, and delete controls", async () => {
    mockFetch("administrator");
    renderPage();

    expect(await screen.findByRole("button", { name: "+ New type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});

describe("ContentTypesPage as an author", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows types read-only, with no create or delete controls", async () => {
    mockFetch("author");
    renderPage();

    expect(await screen.findByText("Product")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ New type" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});
