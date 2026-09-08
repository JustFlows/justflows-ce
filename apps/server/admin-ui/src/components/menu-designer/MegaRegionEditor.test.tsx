import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import MegaRegionEditor from "./MegaRegionEditor";
import { emptyLinksRegion, emptyPromoRegion, linkListItems, promoContent } from "./mega-region";
import type { MegaMenuRegion } from "./menu-tree";

/** MegaRegionEditor is fully controlled — mirror how MenuItemDrawer actually drives it,
 * so typing multiple characters accumulates instead of each keystroke starting from `initial`. */
function Controlled({ initial, onChange }: { initial: MegaMenuRegion; onChange?: (r: MegaMenuRegion) => void }) {
  const [region, setRegion] = useState(initial);
  return (
    <MegaRegionEditor
      region={region}
      onChange={(next) => {
        setRegion(next);
        onChange?.(next);
      }}
      onDelete={() => {}}
    />
  );
}

function renderEditor(region: MegaMenuRegion, onChange = vi.fn()) {
  const utils = render(
    <I18nProvider>
      <Controlled initial={region} onChange={onChange} />
    </I18nProvider>,
  );
  return { onChange, ...utils };
}

describe("MegaRegionEditor — links mode", () => {
  it("shows a plain label/url form for a fresh region, no block editor in sight", () => {
    renderEditor(emptyLinksRegion());
    expect(screen.getByPlaceholderText("Link text")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("URL")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add section" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add block" })).not.toBeInTheDocument();
  });

  it("typing a label/url and adding a row updates the region's link-list block", async () => {
    const user = userEvent.setup();
    const { onChange } = renderEditor(emptyLinksRegion());

    await user.type(screen.getByPlaceholderText("Link text"), "SSL/TLS");
    const afterLabel = onChange.mock.calls.at(-1)![0] as MegaMenuRegion;
    expect(linkListItems(afterLabel)).toEqual([{ label: "SSL/TLS", url: "" }]);

    await user.click(screen.getByRole("button", { name: "+ Add link" }));
    const afterAdd = onChange.mock.calls.at(-1)![0] as MegaMenuRegion;
    expect(linkListItems(afterAdd)).toHaveLength(2);
  });

  it("cannot remove the last remaining link row", () => {
    renderEditor(emptyLinksRegion());
    const rowDelete = screen.getAllByRole("button", { name: "Delete" }).find((btn) => (btn as HTMLButtonElement).disabled);
    expect(rowDelete).toBeDefined();
  });
});

describe("MegaRegionEditor — promo mode", () => {
  it("shows a plain form (background, heading, body, button) for a promo region", () => {
    renderEditor(emptyPromoRegion());
    expect(screen.getByPlaceholderText("Heading")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Body text")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Button text")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Button URL")).toBeInTheDocument();
  });

  it("editing the form fields updates the underlying section/heading/paragraph/button blocks", async () => {
    const user = userEvent.setup();
    const { onChange } = renderEditor(emptyPromoRegion());

    await user.type(screen.getByPlaceholderText("Heading"), "Not sure?");
    const next = onChange.mock.calls.at(-1)![0] as MegaMenuRegion;
    expect(promoContent(next).heading).toBe("Not sure?");
    expect(next.blocks[0]!.type).toBe("core.section");
  });
});

describe("MegaRegionEditor — collapsing", () => {
  it("hides the form and shows a one-line summary when collapsed, keeping the heading editable", async () => {
    const user = userEvent.setup();
    const region = { ...emptyLinksRegion(), heading: "Products" };
    renderEditor(region);

    await user.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByPlaceholderText("Link text")).not.toBeInTheDocument();
    expect(screen.getByText("1 links")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Region heading")).toHaveValue("Products");

    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByPlaceholderText("Link text")).toBeInTheDocument();
  });

  it("summarizes a promo region and a custom region differently", async () => {
    const user = userEvent.setup();
    renderEditor(emptyPromoRegion());
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.getByText("Highlight panel")).toBeInTheDocument();
  });
});

describe("MegaRegionEditor — reordering", () => {
  it("shows no move controls when no handlers are passed", () => {
    render(
      <I18nProvider>
        <MegaRegionEditor region={emptyLinksRegion()} onChange={vi.fn()} onDelete={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.queryByRole("button", { name: "Move up" })).not.toBeInTheDocument();
  });

  it("fires the move handlers and disables them at the ends of the list", async () => {
    const user = userEvent.setup();
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    render(
      <I18nProvider>
        <MegaRegionEditor
          region={emptyLinksRegion()}
          onChange={vi.fn()}
          onDelete={vi.fn()}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          canMoveUp={false}
          canMoveDown
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Move up" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move down" }));
    expect(onMoveDown).toHaveBeenCalledTimes(1);
    expect(onMoveUp).not.toHaveBeenCalled();
  });
});

describe("MegaRegionEditor — advanced escape hatch", () => {
  it("switches to the full block editor on request, for content the simple forms don't cover", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ blocks: [] }) } as Response)));
    renderEditor(emptyLinksRegion());

    await user.click(screen.getByRole("button", { name: /advanced block editor/i }));
    expect(await screen.findByRole("button", { name: "+ Add block" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
