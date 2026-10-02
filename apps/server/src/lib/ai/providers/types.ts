// SPDX-License-Identifier: MIT

/**
 * The one internal interface every AI provider adapter implements (#159):
 * streaming chat with tool calling and image input, plus model listing.
 *
 * Each provider lives in its own folder (`anthropic/`, `openai/`,
 * `openai-compatible/`) and is registered in `index.ts`. The conversation
 * format here is provider-neutral; adapters translate it to and from their
 * wire format. A later item can let plugins register more adapters.
 */

export const PROVIDER_IDS = ["anthropic", "openai", "openai-compatible"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderConfig {
  provider: ProviderId;
  apiKey: string;
  /** Overrides the provider's default endpoint; required for openai-compatible. */
  baseUrl?: string | null;
  organization?: string | null;
  project?: string | null;
  /** Only true for an administrator-approved private endpoint (local Ollama). */
  allowPrivate?: boolean;
}

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string };

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "user"; content: string | ChatContentPart[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; stopReason: string };

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  /** Default API root, without a trailing slash. Null when one must be given. */
  defaultBaseUrl: string | null;
  listModels(config: ProviderConfig): Promise<string[]>;
  chat(config: ProviderConfig, request: ChatRequest): AsyncIterable<ChatEvent>;
}

export type ProviderErrorKind = "invalid_key" | "quota" | "model" | "rate_limit" | "endpoint" | "network" | "other";

/**
 * A provider failure with a message safe to show the user. Never carries the
 * provider's raw response, which can echo request headers or the key.
 */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
