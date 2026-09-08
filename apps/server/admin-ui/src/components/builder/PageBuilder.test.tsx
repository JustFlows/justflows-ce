import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@components/SessionProvider";
import { I18nProvider } from "../../i18n/I18nProvider";
import PageBuilder from "./PageBuilder";
import type { BlockCatalogEntry, BlockDocument } from "./types";

/** PageBuilder is fully controlled — the parent owns `value` and re-renders on `onChange`,
 * same as every real caller (MenuItemDrawer, PageBuilderPage, ...). */
function Controlled({ initial, ...props }: { initial: BlockDocument } & Omit<
  React.ComponentProps<typeof PageBuilder>,
  "value" | "onChange"
>) {
  const [value, setValue] = useState(initial);
  return <PageBuilder value={value} onChange={setValue} {...props} />;
}

const CATALOG: BlockCatalogEntry[] = [
  { type: "core.section", version: 1, title: "Section", category: "layout", supportsChildren: true },
  { type: "core.hero", version: 1, title: "Hero", category: "sections", supportsChildren: false },
  { type: "core.html", version: 1, title: "Custom HTML", category: "content", supportsChildren: false },
  { type: "core.paragraph", version: 1, title: "Paragraph", category: "content", supportsChildren: false },
  { type: "core.image", version: 1, title: "Image", category: "media", supportsChildren: false },
];

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
}

function mockFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("/api/blocks")) return jsonResponse({ blocks: CATALOG });
      return jsonResponse({});
    }),
  );
}

describe("PageBuilder allowedBlockTypes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers every fetched block type when unrestricted", async () => {
    mockFetch();
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <PageBuilder value={{ version: 1, blocks: [] }} onChange={() => {}} compact />
      </I18nProvider>,
    );

    const addBtn = await screen.findByRole("button", { name: "+ Add section" });
    await user.click(addBtn);
    expect(screen.getByRole("button", { name: /Section/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hero/ })).toBeInTheDocument();
  });

  it("restricts the add-block picker to the given allowlist, e.g. a mega-menu region's safe subset", async () => {
    mockFetch();
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <PageBuilder
          value={{ version: 1, blocks: [] }}
          onChange={() => {}}
          compact
          allowedBlockTypes={["core.section"]}
        />
      </I18nProvider>,
    );

    const addBtn = await screen.findByRole("button", { name: "+ Add section" });
    await user.click(addBtn);
    expect(screen.getByRole("button", { name: /Section/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hero/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Custom HTML/ })).not.toBeInTheDocument();
  });

  it("selects a newly inserted nested block so its settings show immediately, no extra click", async () => {
    mockFetch();
    const user = userEvent.setup();
    const { container } = render(
      <SessionProvider>
        <I18nProvider>
          <Controlled
            initial={{ version: 1, blocks: [{ id: "s1", type: "core.section", version: 1, props: {}, children: [] }] }}
            compact
            allowedBlockTypes={["core.section", "core.paragraph"]}
          />
        </I18nProvider>
      </SessionProvider>,
    );

    // Nothing is selected yet: the compact aside shows the page-JSON panel, not a block inspector.
    await screen.findByRole("button", { name: "+ Add block" });
    const aside = container.querySelector("aside")!;
    expect(aside.querySelector("#jf-page-json")).not.toBeNull();

    // The Section's own nested "+ Add block" slot (not the root one, which only offers Section).
    await user.click(screen.getByRole("button", { name: "+ Add block" }));
    await user.click(screen.getByRole("button", { name: /Paragraph/ }));

    // BlockInspector headers itself with the *selected* block's own catalog title. Scoped to the
    // aside so this can't be satisfied by the canvas's own always-visible per-row type label, and
    // asserting "Paragraph" specifically (not e.g. "Section") rules out the enclosing block having
    // been selected instead by an unrelated click-bubbling path.
    expect(aside.textContent).toContain("Paragraph");
    expect(aside.textContent).not.toContain("Section");
  });

  it("offers every allowed block directly at the root when flatCanvas is set, skipping the Section-first requirement", async () => {
    mockFetch();
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <PageBuilder
          value={{ version: 1, blocks: [] }}
          onChange={() => {}}
          compact
          flatCanvas
          allowedBlockTypes={["core.section", "core.image"]}
        />
      </I18nProvider>,
    );

    const addBtn = await screen.findByRole("button", { name: "+ Add block" });
    await user.click(addBtn);
    expect(screen.getByRole("button", { name: /Section/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Image/ })).toBeInTheDocument();
  });
});
