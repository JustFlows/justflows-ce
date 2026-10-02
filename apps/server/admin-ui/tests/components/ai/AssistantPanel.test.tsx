import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AssistantPanel from "../../../src/components/ai/AssistantPanel";

vi.mock("../../../src/i18n/I18nProvider", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("../../../src/admin-router", () => ({ Link: ({ children }: { children: unknown }) => children }));
const session = vi.hoisted(() => ({ canConfigure: true }));
vi.mock("../../../src/components/SessionProvider", () => ({ useCapability: () => session.canConfigure }));

const executes: unknown[] = [];
let chatCalls = 0;

function ndjson(events: unknown[]): Response {
  return new Response(events.map((event) => `${JSON.stringify(event)}\n`).join(""), { status: 200 });
}

beforeEach(() => {
  executes.length = 0;
  chatCalls = 0;
  // Storage may be unavailable in this environment; the panel copes either way.
  window.sessionStorage?.clear();
  window.localStorage?.clear();
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/assistant/status")) {
        return new Response(
          JSON.stringify({
            enabled: true,
            allowed: true,
            providers: [{ source: "site", provider: "anthropic", label: null, models: ["claude"], defaultModel: "claude" }],
            usage: { day: "2026-10-01", requests: 1, inputTokens: 0, outputTokens: 0, limit: null },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/assistant/chat")) {
        chatCalls += 1;
        if (chatCalls === 1) {
          return ndjson([
            { type: "message", message: { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "content_update", arguments: { id: "c1", title: "New" } }] } },
            {
              type: "confirm",
              call: { id: "t1", name: "content_update", arguments: { id: "c1", title: "New" } },
              title: "Update an entry",
              destructive: false,
              preview: { summary: "Update an entry: “Old”", changes: [{ field: "title", before: "Old", after: "New" }] },
            },
            { type: "usage", inputTokens: 10, outputTokens: 4 },
            { type: "done", reason: "awaiting_confirmation" },
          ]);
        }
        return ndjson([
          { type: "text", delta: "Done." },
          { type: "message", message: { role: "assistant", content: "Done." } },
          { type: "done", reason: "complete" },
        ]);
      }
      if (url.endsWith("/assistant/execute")) {
        executes.push(JSON.parse(String(init!.body)));
        return new Response(JSON.stringify({ message: { role: "tool", toolCallId: "t1", name: "content_update", content: "ok" } }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
});

describe("AssistantPanel", () => {
  it("shows a proposed change with its diff and runs it only after Approve", async () => {
    const user = userEvent.setup();
    render(<AssistantPanel onClose={() => {}} />);
    await user.type(await screen.findByRole("textbox", { name: "ai.assistant.placeholder" }), "Retitle c1");
    await user.click(screen.getByRole("button", { name: "ai.assistant.send" }));

    expect(await screen.findByText("Update an entry: “Old”")).toBeInTheDocument();
    expect(screen.getByText("Old")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(executes).toHaveLength(0);
    // The composer is locked until the change is answered.
    expect(screen.getByRole("textbox", { name: "ai.assistant.placeholder" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "ai.assistant.approve" }));
    await waitFor(() => expect(executes).toEqual([{ call: { id: "t1", name: "content_update", arguments: { id: "c1", title: "New" } }, approve: true }]));
    // The conversation continues with the tool result.
    expect(await screen.findByText("Done.")).toBeInTheDocument();
    expect(chatCalls).toBe(2);
  });

  it("sends a decline instead of running the change", async () => {
    const user = userEvent.setup();
    render(<AssistantPanel onClose={() => {}} />);
    await user.type(await screen.findByRole("textbox", { name: "ai.assistant.placeholder" }), "Retitle c1");
    await user.click(screen.getByRole("button", { name: "ai.assistant.send" }));
    await user.click(await screen.findByRole("button", { name: "ai.assistant.decline" }));
    await waitFor(() => expect(executes).toEqual([expect.objectContaining({ approve: false })]));
  });

  it("survives New chat and Close when scrollIntoView returns a Promise (current Chrome)", async () => {
    // Chrome's scroll methods now return a Promise. An effect that returned it
    // made React call a Promise as the cleanup and unmount the whole admin.
    Element.prototype.scrollIntoView = (() => Promise.resolve()) as unknown as typeof Element.prototype.scrollIntoView;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ enabled: true, allowed: true, providers: [], usage: null }), { status: 200 })));
    const onClose = vi.fn();
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const user = userEvent.setup();
      const { unmount } = render(<AssistantPanel onClose={onClose} />);
      await screen.findByText("ai.assistant.noProvider", { exact: false });
      await user.click(screen.getByRole("button", { name: "ai.assistant.newChat" }));
      await user.click(screen.getByRole("button", { name: "common.close" }));
      expect(onClose).toHaveBeenCalled();
      unmount();
    } finally {
      console.error = original;
    }
    expect(errors.map(String).join("\n")).not.toMatch(/is not a function/);
  });

  it("links administrators to Settings → AI and tells everyone else to ask one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ enabled: true, allowed: true, providers: [], usage: null }), { status: 200 })));
    const { unmount } = render(<AssistantPanel onClose={() => {}} />);
    expect(await screen.findByText("ai.assistant.addKey", { exact: false })).toBeInTheDocument();
    unmount();
    session.canConfigure = false;
    render(<AssistantPanel onClose={() => {}} />);
    expect(await screen.findByText("ai.assistant.askAdmin", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("ai.assistant.addKey", { exact: false })).toBeNull();
    session.canConfigure = true;
  });
});
