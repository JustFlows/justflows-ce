// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicAdapter, toAnthropicMessages } from "../../../src/lib/ai/providers/anthropic/adapter.js";
import { openAiAdapter } from "../../../src/lib/ai/providers/openai/adapter.js";
import { openAiCompatibleAdapter } from "../../../src/lib/ai/providers/openai-compatible/adapter.js";
import { toOpenAiMessages } from "../../../src/lib/ai/providers/openai/chat-completions.js";
import { ProviderError, type ChatEvent, type ChatMessage } from "../../../src/lib/ai/providers/types.js";

function sse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function collect(stream: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

afterEach(() => vi.unstubAllGlobals());

const conversation: ChatMessage[] = [
  { role: "user", content: [{ type: "text", text: "Describe" }, { type: "image", mediaType: "image/png", data: "AAAA" }] },
  { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "content_get", arguments: { id: "c1" } }] },
  { role: "tool", toolCallId: "t1", name: "content_get", content: "{}" },
];

describe("message conversion", () => {
  it("maps tool results onto Anthropic user turns", () => {
    const wire = toAnthropicMessages(conversation);
    expect(wire.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(wire[0]!.content[1]).toMatchObject({ type: "image", source: { media_type: "image/png", data: "AAAA" } });
    expect(wire[1]!.content[0]).toMatchObject({ type: "tool_use", id: "t1", input: { id: "c1" } });
    expect(wire[2]!.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
  });

  it("maps tool calls and images onto Chat Completions", () => {
    const wire = toOpenAiMessages("sys", conversation);
    expect(wire[0]).toEqual({ role: "system", content: "sys" });
    expect((wire[1]!.content as { type: string; image_url?: { url: string } }[])[1]?.image_url?.url).toBe("data:image/png;base64,AAAA");
    expect(wire[2]).toMatchObject({ tool_calls: [{ id: "t1", function: { name: "content_get", arguments: '{"id":"c1"}' } }] });
    expect(wire[3]).toEqual({ role: "tool", tool_call_id: "t1", content: "{}" });
  });
});

describe("Anthropic streaming", () => {
  it("streams text, assembles tool input JSON and reports usage", async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        { type: "message_start", message: { usage: { input_tokens: 12, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu1", name: "content_list" } },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"type":' } },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"post"}' } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 30 } },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const events = await collect(
      anthropicAdapter.chat({ provider: "anthropic", apiKey: "k-123456789" }, { model: "claude", system: "s", messages: [{ role: "user", content: "hi" }] }),
    );
    expect(events).toEqual([
      { type: "text", delta: "Hi" },
      { type: "tool_call", call: { id: "tu1", name: "content_list", arguments: { type: "post" } } },
      { type: "usage", inputTokens: 12, outputTokens: 30 },
      { type: "done", stopReason: "tool_use" },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k-123456789");
  });

  it("maps a 401 to an invalid-key error without echoing the response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"invalid x-api-key k-123456789"}}', { status: 401 })));
    const error = await collect(
      anthropicAdapter.chat({ provider: "anthropic", apiKey: "k-123456789" }, { model: "m", system: "", messages: [] }),
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe("invalid_key");
    expect((error as Error).message).not.toContain("k-123456789");
  });
});

describe("OpenAI streaming", () => {
  it("accumulates streamed tool call fragments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse([
          { choices: [{ delta: { content: "Ok" } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "media_", arguments: '{"li' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "list", arguments: 'mit":5}' } }] }, finish_reason: "tool_calls" }] },
          { choices: [], usage: { prompt_tokens: 7, completion_tokens: 9 } },
          "[DONE]",
        ]),
      ),
    );
    const events = await collect(
      openAiAdapter.chat({ provider: "openai", apiKey: "sk-12345678" }, { model: "gpt", system: "s", messages: [{ role: "user", content: "x" }] }),
    );
    expect(events).toContainEqual({ type: "tool_call", call: { id: "c1", name: "media_list", arguments: { limit: 5 } } });
    expect(events).toContainEqual({ type: "usage", inputTokens: 7, outputTokens: 9 });
  });

  it("filters the OpenAI model list to chat models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ id: "gpt-5" }, { id: "text-embedding-3-small" }, { id: "gpt-4o-realtime" }, { id: "o4-mini" }] })),
    );
    expect(await openAiAdapter.listModels({ provider: "openai", apiKey: "sk-12345678" })).toEqual(["gpt-5", "o4-mini"]);
  });

  it("refuses a private compatible endpoint unless it was explicitly allowed", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ id: "llama3" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const config = { provider: "openai-compatible" as const, apiKey: "ollama", baseUrl: "http://127.0.0.1:11434/v1" };
    await expect(openAiCompatibleAdapter.listModels(config)).rejects.toMatchObject({ kind: "endpoint" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await openAiCompatibleAdapter.listModels({ ...config, allowPrivate: true })).toEqual(["llama3"]);
  });
});
