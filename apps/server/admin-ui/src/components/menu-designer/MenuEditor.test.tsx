import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import MenuEditor, { type EditableMenu } from "./MenuEditor";

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

function mockFetch() {
  const fetchMock = vi.fn(() => jsonResponse({ menu: { id: "m1", slug: "primary", name: "Primary", items: [] } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const baseMenu: EditableMenu = {
  id: "m1",
  slug: "primary",
  name: "Primary",
  items: [
    { id: "a", label: "About", type: "custom", url: "/about" },
    { id: "b", label: "Contact", type: "custom", url: "/contact" },
  ],
};

function renderEditor(menu: EditableMenu = baseMenu) {
  return render(
    <I18nProvider>
      <MenuEditor
        menu={menu}
        canManage
        contentTypes={[]}
        contentByType={{}}
        activeLocales={["en"]}
        designPresets={[]}
        onPublished={() => {}}
      />
    </I18nProvider>,
  );
}

describe("MenuEditor", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not lose the loaded menu if Undo is pressed with no edits made", async () => {
    mockFetch();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    expect(await screen.findByText("About")).toBeInTheDocument();
    const undoBtn = screen.getByRole("button", { name: "Undo" });
    expect(undoBtn).toBeDisabled();
    await user.click(undoBtn);
    expect(screen.getByText("About")).toBeInTheDocument();
    expect(screen.getByText("Contact")).toBeInTheDocument();
  });

  it("enables undo after an edit and restores the prior state", async () => {
    mockFetch();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    await screen.findByText("About");
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    await user.click(deleteButtons[0]!);
    expect(screen.queryByText("About")).not.toBeInTheDocument();

    const undoBtn = screen.getByRole("button", { name: "Undo" });
    expect(undoBtn).not.toBeDisabled();
    await user.click(undoBtn);
    expect(await screen.findByText("About")).toBeInTheDocument();
  });

  it("indents an item under its previous sibling", async () => {
    mockFetch();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    await screen.findByText("Contact");
    const rows = screen.getAllByText(/About|Contact/).map((el) => el.closest(".jf-itemrow")!);
    const contactRow = rows[1]!;
    const indentBtn = contactRow.querySelector('[aria-label="Indent"]') as HTMLElement;
    await user.click(indentBtn);

    expect(document.querySelector('.jf-itemrow[data-depth="1"]')?.textContent).toContain("Contact");
  });

  it("autosaves a draft after an edit settles", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    await screen.findByText("About");
    fetchMock.mockClear();
    await user.click(screen.getAllByRole("button", { name: "Duplicate" })[0]!);

    await vi.advanceTimersByTimeAsync(1000);

    const draftCall = fetchMock.mock.calls.find(([, init]) => {
      const body = (init as RequestInit | undefined)?.body;
      return typeof body === "string" && body.includes('"draft":true');
    });
    expect(draftCall).toBeDefined();
  });
});
