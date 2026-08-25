import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuilderDragProvider } from "./DragContext";
import GridEditor from "./GridEditor";
import type { BlockNode } from "./types";

const GRID_LEFT = 100;
const GRID_WIDTH = 1200; // 12 tracks of 100px
const GRID_TOP = 50;

const grid: BlockNode = { id: "grid", type: "core.grid", version: 1, props: { columns: 12, gap: "none" } };

function child(id: string, layout?: Record<string, number>): BlockNode {
  return { id, type: "core.paragraph", version: 1, props: layout ? { layout } : {} };
}

// Captured once: re-reading it inside the stub would pick up the previous
// test's spy and recurse.
const realComputedStyle = window.getComputedStyle.bind(window);
const realRect = Element.prototype.getBoundingClientRect;

/** jsdom does no layout, so the grid is given the box and tracks the maths reads. */
function stubLayout(): void {
  Element.prototype.getBoundingClientRect = function () {
    return { left: GRID_LEFT, top: GRID_TOP, width: GRID_WIDTH, height: 400, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
  };
  vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
    const style = realComputedStyle(el, pseudo ?? undefined);
    return new Proxy(style, {
      get: (target, key) =>
        key === "gridTemplateRows" ? "100px 100px" : key === "rowGap" ? "0px" : Reflect.get(target, key),
    }) as CSSStyleDeclaration;
  });
}

/** Pointer x for the middle of a 1-based column. */
function xOfColumn(col: number): number {
  return GRID_LEFT + (col - 1) * (GRID_WIDTH / 12) + 50;
}

function mount(children: BlockNode[]) {
  const onChildrenChange = vi.fn();
  render(
    <BuilderDragProvider blocks={[grid]} catalog={new Map()} onChange={() => {}} onSelect={() => {}}>
      <GridEditor
        block={grid}
        children={children}
        onChildrenChange={onChildrenChange}
        onSelect={() => {}}
        selectedId={null}
        renderChild={(c) => <div>{c.id}</div>}
      />
    </BuilderDragProvider>,
  );
  return onChildrenChange;
}

function drag(handle: Element, toColumn: number, toY = GRID_TOP + 50) {
  fireEvent.pointerDown(handle, { button: 0, clientX: xOfColumn(1), clientY: GRID_TOP + 50 });
  fireEvent.pointerMove(document, { clientX: xOfColumn(toColumn), clientY: toY });
  fireEvent.pointerUp(document);
}

function lastLayout(fn: ReturnType<typeof vi.fn>, id: string): unknown {
  const children = fn.mock.calls.at(-1)?.[0] as BlockNode[];
  return children.find((c) => c.id === id)?.props.layout;
}

describe("GridEditor", () => {
  beforeEach(() => {
    stubLayout();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Element.prototype.getBoundingClientRect = realRect;
  });

  it("shows each block's span on its handle", () => {
    mount([child("a", { col: 3, span: 4 })]);
    expect(screen.getByTitle("Drag to move on the grid")).toHaveTextContent("3–6");
  });

  it("moves a block to the column it was dragged to, keeping its width", () => {
    const onChange = mount([child("a", { col: 1, span: 4 })]);
    drag(screen.getByTitle("Drag to move on the grid"), 7);
    expect(lastLayout(onChange, "a")).toEqual({ col: 7, span: 4, row: 1 });
  });

  it("pins the row the pointer was over", () => {
    const onChange = mount([child("a", { col: 1, span: 4 })]);
    drag(screen.getByTitle("Drag to move on the grid"), 5, GRID_TOP + 150);
    expect(lastLayout(onChange, "a")).toMatchObject({ row: 2 });
  });

  it("widens a block when its right edge is dragged out", () => {
    const onChange = mount([child("a", { col: 1, span: 2 })]);
    drag(screen.getByTitle("Drag to change the width"), 9);
    expect(lastLayout(onChange, "a")).toEqual({ col: 1, span: 9 });
  });

  it("moves the start column when the left edge is dragged, holding the right edge", () => {
    const onChange = mount([child("a", { col: 5, span: 4 })]);
    drag(screen.getByTitle("Drag to change the start column"), 2);
    expect(lastLayout(onChange, "a")).toEqual({ col: 2, span: 7 });
  });

  it("stores nothing when a block ends up simply full width", () => {
    const onChange = mount([child("a", { col: 3, span: 12 })]);
    drag(screen.getByTitle("Drag to change the start column"), 1);
    const children = onChange.mock.calls.at(-1)?.[0] as BlockNode[];
    expect(children[0]?.props).not.toHaveProperty("layout");
  });

  it("keeps a block inside the grid however far it is dragged", () => {
    const onChange = mount([child("a", { col: 1, span: 5 })]);
    drag(screen.getByTitle("Drag to move on the grid"), 12);
    expect(lastLayout(onChange, "a")).toMatchObject({ col: 8, span: 5 });
  });
});
