// SPDX-License-Identifier: MIT

import { apiRoot, parseToolArguments, providerFetch, providerJson, readSse } from "../http.js";
import type { ChatEvent, ChatMessage, ChatRequest, ProviderConfig } from "../types.js";

/**
 * The OpenAI Chat Completions wire format — streaming, function calling and
 * image input. Shared by the `openai` adapter and the `openai-compatible` one
 * (OpenRouter, Azure OpenAI, Mistral, Groq, Ollama, LM Studio).
 */

// Streamed chunks are untyped JSON; fields are read defensively below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Chunk = Record<string, any>;

export function openAiHeaders(config: ProviderConfig): Record<string, string> {
  return {
    authorization: `Bearer ${config.apiKey}`,
    "content-type": "application/json",
    accept: "application/json",
    ...(config.organization ? { "OpenAI-Organization": config.organization } : {}),
    ...(config.project ? { "OpenAI-Project": config.project } : {}),
  };
}

export function toOpenAiMessages(system: string, messages: ChatMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({
        role: "user",
        content:
          typeof message.content === "string"
            ? message.content
            : message.content.map((part) =>
                part.type === "text"
                  ? { type: "text", text: part.text }
                  : { type: "image_url", image_url: { url: `data:${part.mediaType};base64,${part.data}` } },
              ),
      });
    } else if (message.role === "assistant") {
      out.push({
        role: "assistant",
        content: message.content || null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      });
    } else {
      out.push({ role: "tool", tool_call_id: message.toolCallId, content: message.content });
    }
  }
  return out;
}

export async function listOpenAiModels(config: ProviderConfig, fallbackBase: string | null): Promise<string[]> {
  const response = await providerFetch(config, `${apiRoot(config, fallbackBase)}/models`, {
    headers: openAiHeaders(config),
    timeoutMs: 20_000,
  });
  const body = await providerJson<{ data?: { id?: string }[] }>(response);
  return (body.data ?? [])
    .map((model) => String(model.id ?? ""))
    .filter(Boolean)
    .sort();
}

export async function* streamChatCompletions(
  config: ProviderConfig,
  request: ChatRequest,
  fallbackBase: string | null,
  options: { includeUsage: boolean } = { includeUsage: true },
): AsyncIterable<ChatEvent> {
  const response = await providerFetch(config, `${apiRoot(config, fallbackBase)}/chat/completions`, {
    method: "POST",
    headers: { ...openAiHeaders(config), accept: "text/event-stream" },
    signal: request.signal,
    timeoutMs: 300_000,
    body: JSON.stringify({
      model: request.model,
      messages: toOpenAiMessages(request.system, request.messages),
      stream: true,
      ...(options.includeUsage ? { stream_options: { include_usage: true } } : {}),
      ...(request.maxTokens ? { max_completion_tokens: request.maxTokens } : {}),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
            })),
          }
        : {}),
    }),
  });

  const calls = new Map<number, { id: string; name: string; args: string }>();
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason = "stop";
  for await (const { data } of readSse(response)) {
    if (data === "[DONE]") break;
    let chunk: Chunk;
    try {
      chunk = JSON.parse(data) as Chunk;
    } catch {
      continue;
    }
    if (chunk.usage) {
      inputTokens = Number(chunk.usage.prompt_tokens ?? inputTokens);
      outputTokens = Number(chunk.usage.completion_tokens ?? outputTokens);
    }
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};
    if (typeof delta.content === "string" && delta.content) yield { type: "text", delta: delta.content };
    for (const part of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const index = Number(part.index ?? 0);
      const call = calls.get(index) ?? { id: "", name: "", args: "" };
      if (part.id) call.id = String(part.id);
      if (part.function?.name) call.name += String(part.function.name);
      if (part.function?.arguments) call.args += String(part.function.arguments);
      calls.set(index, call);
    }
    if (choice.finish_reason) stopReason = String(choice.finish_reason);
  }
  for (const [index, call] of [...calls.entries()].sort(([a], [b]) => a - b)) {
    if (!call.name) continue;
    yield { type: "tool_call", call: { id: call.id || `call_${index}`, name: call.name, arguments: parseToolArguments(call.args) } };
  }
  yield { type: "usage", inputTokens, outputTokens };
  yield { type: "done", stopReason };
}
