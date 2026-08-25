import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import PageJsonPanel from "./PageJsonPanel";
import type { BlockNode } from "./types";

/** jsdom here runs without a storage area, and the provider reads one on mount. */
function installStorage(): void {
  const entries = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return entries.size;
      },
      key: (i: number) => [...entries.keys()][i] ?? null,
      getItem: (k: string) => entries.get(k) ?? null,
      setItem: (k: string, v: string) => void entries.set(k, String(v)),
      removeItem: (k: string) => void entries.delete(k),
      clear: () => entries.clear(),
    } as Storage,
  });
}

const one: BlockNode = { id: "b1", type: "core.paragraph", version: 1, props: { text: "One" } };
const two: BlockNode = { id: "b2", type: "core.paragraph", version: 1, props: { text: "Two" } };

function mount(blocks: BlockNode[], onApply = vi.fn()) {
  const view = render(
    <I18nProvider>
      <PageJsonPanel blocks={blocks} onApply={onApply} />
    </I18nProvider>,
  );
  const area = () => screen.getByRole("textbox") as HTMLTextAreaElement;
  return { ...view, area, onApply };
}

describe("PageJsonPanel", () => {
  beforeEach(() => {
    installStorage();
    // The provider looks for a served catalog and falls back to the bundled one.
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  });

  it("shows the whole page when nothing is selected", () => {
    const { area } = mount([one, two]);
    expect(JSON.parse(area().value)).toEqual({ version: 1, blocks: [one, two] });
    expect(screen.getByText("2 blocks")).toBeInTheDocument();
  });

  it("follows the canvas while the editor has not typed", () => {
    const { area, rerender } = mount([one]);
    rerender(
      <I18nProvider>
        <PageJsonPanel blocks={[one, two]} onApply={vi.fn()} />
      </I18nProvider>,
    );
    expect(JSON.parse(area().value).blocks).toHaveLength(2);
  });

  it("holds a half-written edit instead of being overwritten from the canvas", async () => {
    const user = userEvent.setup();
    const { area, rerender } = mount([one]);
    await user.clear(area());
    await user.type(area(), "{{");
    rerender(
      <I18nProvider>
        <PageJsonPanel blocks={[one, two]} onApply={vi.fn()} />
      </I18nProvider>,
    );
    expect(area().value).toBe("{");
    expect(screen.getByText(/changed on the canvas/i)).toBeInTheDocument();
  });

  it("applies edited JSON back to the page", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const { area } = mount([one], onApply);
    await user.clear(area());
    await user.paste('{"version":1,"blocks":[{"id":"b9","type":"core.heading","props":{"text":"Hi"}}]}');
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith({
      blocks: [{ id: "b9", type: "core.heading", version: 1, props: { text: "Hi" } }],
    });
  });

  it("reports bad JSON and does not touch the page", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const { area } = mount([one], onApply);
    await user.clear(area());
    await user.paste('{"blocks":[{"props":{}}]}');
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/Block 1 needs a "type"/)).toBeInTheDocument();
  });

  it("discards an edit back to what the canvas holds", async () => {
    const user = userEvent.setup();
    const { area } = mount([one]);
    await user.clear(area());
    await user.paste("junk");
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(JSON.parse(area().value).blocks).toEqual([one]);
  });

  it("offers nothing to apply until something is edited", () => {
    mount([one]);
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
  });
});
