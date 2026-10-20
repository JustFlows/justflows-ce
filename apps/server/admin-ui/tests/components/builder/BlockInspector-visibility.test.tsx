import { render, screen } from "@testing-library/react";
import { coreBlocks } from "@justflows/blocks";
import { describe, expect, it, vi } from "vitest";
import BlockInspector from "../../../src/components/builder/BlockInspector";
import type { BlockCatalogEntry } from "../../../src/components/builder/types";

vi.mock("../../../src/i18n/I18nProvider", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("../../../src/lib/theme-style-tokens", () => ({ useThemeStyleTokens: () => ({ theme: "", tokens: [], blockControls: {} }) }));

describe("core inspector dependent fields", () => {
  it.each([
    ["core.cover", "mediaType", "image", "video", "loop"],
    ["core.media-text", "mediaType", "image", "video", "poster"],
    ["core.list", "listStyle", "bullet", "numbered", "start"],
    ["core.callout", "dismissible", false, true, "dismissLabel"],
    ["core.content-query", "pagination", false, true, "pageKey"],
    ["core.content-query", "layout", "list", "grid", "columns"],
    ["core.navigation", "mobileCollapse", false, true, "menuLabel"],
    ["core.breadcrumbs", "showCurrent", false, true, "separator"],
  ])("%s shows %s-dependent controls only when relevant", (type, controller, off, on, field) => {
    const definition = coreBlocks.find((block) => block.type === type)!;
    const catalogEntry: BlockCatalogEntry = { ...definition, supportsChildren: definition.supportsChildren ?? false };
    const onChange = vi.fn();
    const props = { [controller]: off };
    const block = { id: "b1", type, version: 1, props };
    const { rerender } = render(<BlockInspector block={block} catalogEntry={catalogEntry} onChange={onChange} compact />);
    const label = field === "poster" ? "builder.media.poster" : `builder.functional.fields.${field}`;
    expect(screen.queryByText(label)).not.toBeInTheDocument();
    rerender(<BlockInspector block={{ ...block, props: { [controller]: on } }} catalogEntry={catalogEntry} onChange={onChange} compact />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(props[controller]).toBe(off);
  });

  it("shows checkbox state only for items in a checklist", () => {
    const definition = coreBlocks.find((block) => block.type === "core.list-item")!;
    const catalogEntry: BlockCatalogEntry = { ...definition, supportsChildren: definition.supportsChildren ?? false };
    const block = { id: "item", type: definition.type, version: 1, props: { checked: true } };
    const onChange = vi.fn();
    const { rerender } = render(<BlockInspector block={block} catalogEntry={catalogEntry} onChange={onChange} parentType="core.list" parentListStyle="bullet" compact />);
    expect(screen.queryByText("builder.functional.fields.checked")).not.toBeInTheDocument();
    rerender(<BlockInspector block={block} catalogEntry={catalogEntry} onChange={onChange} parentType="core.list" parentListStyle="checklist" compact />);
    expect(screen.getByText("builder.functional.fields.checked")).toBeInTheDocument();
    expect(block.props.checked).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hides labels for disabled account links", () => {
    const block = { id: "links", type: "core.auth-links", version: 1, props: { showLogin: false, showRegister: true } };
    render(<BlockInspector block={block} onChange={vi.fn()} compact />);
    expect(screen.queryByText("builder.inspector.authLinks.loginLabel")).not.toBeInTheDocument();
    expect(screen.getByText("builder.inspector.authLinks.registerLabel")).toBeInTheDocument();
  });

  it.each(["select", "switch"])("hides unused colour-scheme icons in the %s variant", (style) => {
    const block = { id: "scheme", type: "core.color-scheme", version: 1, props: { style, showSystem: true } };
    render(<BlockInspector block={block} onChange={vi.fn()} compact />);
    expect(screen.queryByText("builder.inspector.colorScheme.lightIcon")).not.toBeInTheDocument();
    expect(screen.queryByText("builder.inspector.colorScheme.darkIcon")).not.toBeInTheDocument();
    expect(screen.getByText("builder.inspector.colorScheme.darkLabel")).toBeInTheDocument();
    if (style === "switch") {
      expect(screen.queryByText("builder.inspector.colorScheme.showAutoOption")).not.toBeInTheDocument();
      expect(screen.queryByText("builder.inspector.colorScheme.autoLabel")).not.toBeInTheDocument();
      expect(screen.queryByText("builder.inspector.colorScheme.lightLabel")).not.toBeInTheDocument();
    }
  });

});
