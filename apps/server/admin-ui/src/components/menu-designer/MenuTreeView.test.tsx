import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import MenuTreeView from "./MenuTreeView";
import type { MenuItem } from "./menu-tree";

const TREE: MenuItem[] = [
  {
    id: "a",
    label: "About",
    type: "custom",
    url: "/about",
    children: [
      { id: "a1", label: "Team", type: "custom", url: "/about/team" },
      { id: "a2", label: "History", type: "custom", url: "/about/history" },
    ],
  },
  { id: "b", label: "Contact", type: "page", contentId: "page-contact", url: "/contact" },
];

function renderTree(items = TREE) {
  return render(
    <I18nProvider>
      <MenuTreeView
        items={items}
        maxDepth={3}
        selectedId={null}
        canManage
        typeLabel={(t) => t}
        contentSlugFor={(item) => (item.contentId === "page-contact" ? "contact" : undefined)}
        onSelectItem={() => {}}
        onChange={() => {}}
      />
    </I18nProvider>,
  );
}

describe("MenuTreeView collapsing", () => {
  it("shows every row by default", () => {
    renderTree();
    expect(screen.getByText("About")).toBeInTheDocument();
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
  });

  it("hides a parent's children when collapsed, and restores them when expanded again", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByText("Team")).not.toBeInTheDocument();
    expect(screen.queryByText("History")).not.toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
    expect(screen.getByText("2 hidden")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
  });

  it("does not offer a collapse toggle for a leaf item", () => {
    renderTree();
    // Only one parent ("About") exists in the fixture, so exactly one toggle.
    expect(screen.getAllByRole("button", { name: "Collapse" })).toHaveLength(1);
  });
});

describe("MenuTreeView contentSlugFor", () => {
  it("shows the resolved slug next to a content-linked item", () => {
    renderTree();
    expect(screen.getByText("contact")).toBeInTheDocument();
  });
});
