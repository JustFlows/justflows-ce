import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@components/SessionProvider";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import PageBuilder from "../../../src/components/builder/PageBuilder";
import type { BlockCatalogEntry, BlockDocument } from "../../../src/components/builder/types";

const CATALOG: BlockCatalogEntry[] = [
  { type: "core.paragraph", version: 1, title: "Paragraph", category: "content", supportsChildren: false },
  { type: "core.heading", version: 1, title: "Heading", category: "content", supportsChildren: false },
  { type: "core.quote", version: 1, title: "Quote", category: "content", supportsChildren: false },
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

/** Mounts PageBuilder controlled, exposing the latest committed document via a ref-like getter. */
function renderHarness(initial: BlockDocument) {
  let latest = initial;
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <PageBuilder
        value={value}
        onChange={(next) => {
          latest = next;
          setValue(next);
        }}
        compact
      />
    );
  }
  const utils = render(
    <SessionProvider>
      <I18nProvider>
        <Harness />
      </I18nProvider>
    </SessionProvider>,
  );
  return { ...utils, getLatest: () => latest };
}

describe("inline canvas editing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("turns a selected paragraph into a rich-text editor and commits sanitized HTML on blur", async () => {
    mockFetch();
    const user = userEvent.setup();
    const { container, getLatest } = renderHarness({
      version: 1,
      blocks: [{ id: "p1", type: "core.paragraph", version: 1, props: { text: "hello" } }],
    });

    const text = await screen.findByText("hello");
    await user.click(text);

    const editable = container.querySelector('[contenteditable="true"]');
    expect(editable).toBeTruthy();

    fireEvent.focus(editable!);
    expect(screen.getByTitle("Bold (⌘B)")).toBeInTheDocument();

    editable!.innerHTML = "<b>bold</b> hello";
    fireEvent.blur(editable!);

    await waitFor(() => {
      const block = getLatest().blocks.find((b) => b.id === "p1")!;
      expect(block.props.text).toBe("<b>bold</b> hello");
    });
  });

  it("strips disallowed markup from a paragraph on commit", async () => {
    mockFetch();
    const user = userEvent.setup();
    const { container, getLatest } = renderHarness({
      version: 1,
      blocks: [{ id: "p1", type: "core.paragraph", version: 1, props: { text: "hello" } }],
    });

    const text = await screen.findByText("hello");
    await user.click(text);
    const editable = container.querySelector('[contenteditable="true"]')!;

    fireEvent.focus(editable);
    editable.innerHTML = "<script>alert(1)</script>hello";
    fireEvent.blur(editable);

    await waitFor(() => {
      const block = getLatest().blocks.find((b) => b.id === "p1")!;
      expect(block.props.text).toBe("hello");
    });
  });

  it("edits a selected heading as plain text with no formatting toolbar", async () => {
    mockFetch();
    const user = userEvent.setup();
    const { container, getLatest } = renderHarness({
      version: 1,
      blocks: [{ id: "h1", type: "core.heading", version: 1, props: { text: "Title", level: 2 } }],
    });

    const heading = await screen.findByText("Title");
    await user.click(heading);

    const editable = container.querySelector('[contenteditable="true"]');
    expect(editable).toBeTruthy();
    expect(editable?.tagName).toBe("H2");

    fireEvent.focus(editable!);
    expect(screen.queryByTitle("Bold (⌘B)")).not.toBeInTheDocument();

    editable!.textContent = "<b>New</b> title";
    fireEvent.blur(editable!);

    await waitFor(() => {
      const block = getLatest().blocks.find((b) => b.id === "h1")!;
      // Plain-text mode: stored verbatim as text, not parsed as HTML — matches
      // the live renderer, which escapes heading text rather than sanitizing it.
      expect(block.props.text).toBe("<b>New</b> title");
    });
  });

  it("turns a selected quote into a rich-text editor", async () => {
    mockFetch();
    const user = userEvent.setup();
    const { container, getLatest } = renderHarness({
      version: 1,
      blocks: [{ id: "q1", type: "core.quote", version: 1, props: { text: "Quoted" } }],
    });

    const quote = await screen.findByText("Quoted");
    await user.click(quote);

    const editable = container.querySelector('[contenteditable="true"]');
    expect(editable).toBeTruthy();

    fireEvent.focus(editable!);
    expect(screen.getByTitle("Bold (⌘B)")).toBeInTheDocument();

    editable!.innerHTML = "<em>Quoted</em>";
    fireEvent.blur(editable!);

    await waitFor(() => {
      const block = getLatest().blocks.find((b) => b.id === "q1")!;
      expect(block.props.text).toBe("<em>Quoted</em>");
    });
  });
});
