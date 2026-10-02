// SPDX-License-Identifier: MIT

import { apiRoot, parseToolArguments, providerFetch, providerJson, readSse } from "../http.js";
import { ProviderError, type ChatEvent, type ChatMessage, type ChatRequest, type ProviderAdapter, type ProviderConfig } from "../types.js";

/**
 * Anthropic Messages API (Claude models): streaming, tool use, image input.
 */

const DEFAULT_BASE = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";

function headers(config: ProviderConfig): Record<string, string> {
  return {
    "x-api-key": config.apiKey,
    "anthropic-version": API_VERSION,
    "content-type": "application/json",
    accept: "application/json",
  };
}

type Block = Record<string, unknown>;
// Streamed events are untyped JSON; fields are read defensively below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StreamEvent = Record<string, any>;
type WireMessage = { role: "user" | "assistant"; content: Block[] };

/** Map the neutral conversation onto Messages API turns (tool results ride in user turns). */
export function toAnthropicMessages(messages: ChatMessage[]): WireMessage[] {
  const out: WireMessage[] = [];
  const push = (role: WireMessage["role"], blocks: Block[]) => {
    if (blocks.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const message of messages) {
    if (message.role === "user") {
      const parts = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
      push(
        "user",
        parts.map((part) =>
          part.type === "text"
            ? { type: "text", text: part.text }
            : { type: "image", source: { type: "base64", media_type: part.mediaType, data: part.data } },
        ),
      );
    } else if (message.role === "assistant") {
      push("assistant", [
        ...(message.content ? [{ type: "text", text: message.content }] : []),
        ...(message.toolCalls ?? []).map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: call.arguments })),
      ]);
    } else {
      push("user", [
        { type: "tool_result", tool_use_id: message.toolCallId, content: message.content, ...(message.isError ? { is_error: true } : {}) },
      ]);
    }
  }
  return out;
}

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic",
  defaultBaseUrl: DEFAULT_BASE,

  async listModels(config) {
    const response = await providerFetch(config, `${apiRoot(config, DEFAULT_BASE)}/v1/models?limit=100`, {
      headers: headers(config),
      timeoutMs: 20_000,
    });
    const body = await providerJson<{ data?: { id?: string }[] }>(response);
    return (body.data ?? []).map((model) => String(model.id ?? "")).filter(Boolean);
  },

  async *chat(config, request: ChatRequest): AsyncIterable<ChatEvent> {
    const response = await providerFetch(config, `${apiRoot(config, DEFAULT_BASE)}/v1/messages`, {
      method: "POST",
      headers: { ...headers(config), accept: "text/event-stream" },
      signal: request.signal,
      timeoutMs: 300_000,
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        system: request.system,
        messages: toAnthropicMessages(request.messages),
        stream: true,
        ...(request.tools?.length
          ? { tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })) }
          : {}),
      }),
    });

    const pending = new Map<number, { id: string; name: string; json: string }>();
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = "end_turn";
    for await (const { data } of readSse(response)) {
      let event: StreamEvent;
      try {
        event = JSON.parse(data) as StreamEvent;
      } catch {
        continue;
      }
      switch (event.type) {
        case "message_start":
          inputTokens = Number(event.message?.usage?.input_tokens ?? 0);
          outputTokens = Number(event.message?.usage?.output_tokens ?? 0);
          break;
        case "content_block_start":
          if (event.content_block?.type === "tool_use") {
            pending.set(Number(event.index), { id: String(event.content_block.id), name: String(event.content_block.name), json: "" });
          }
          break;
        case "content_block_delta":
          if (event.delta?.type === "text_delta") yield { type: "text", delta: String(event.delta.text ?? "") };
          else if (event.delta?.type === "input_json_delta") {
            const call = pending.get(Number(event.index));
            if (call) call.json += String(event.delta.partial_json ?? "");
          }
          break;
        case "content_block_stop": {
          const call = pending.get(Number(event.index));
          if (call) {
            pending.delete(Number(event.index));
            yield { type: "tool_call", call: { id: call.id, name: call.name, arguments: parseToolArguments(call.json) } };
          }
          break;
        }
        case "message_delta":
          if (event.usage?.output_tokens !== undefined) outputTokens = Number(event.usage.output_tokens);
          if (event.delta?.stop_reason) stopReason = String(event.delta.stop_reason);
          break;
        case "error":
          throw new ProviderError(
            event.error?.type === "overloaded_error" ? "rate_limit" : "other",
            event.error?.type === "overloaded_error" ? "The provider is overloaded. Try again shortly." : "The provider stopped with an error.",
          );
        default:
          break;
      }
    }
    yield { type: "usage", inputTokens, outputTokens };
    yield { type: "done", stopReason };
  },
};
