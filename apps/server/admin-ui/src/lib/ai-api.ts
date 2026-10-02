// SPDX-License-Identifier: MIT

/**
 * Client for the AI endpoints (#159): settings, provider keys, connected apps,
 * and the assistant's NDJSON stream. Provider keys only ever travel from the
 * browser to the server; no response carries one.
 */

export type ProviderId = "anthropic" | "openai" | "openai-compatible";
export type CredentialScope = "site" | "personal";

export interface ProviderCredential {
  provider: ProviderId;
  scope: CredentialScope;
  label: string | null;
  keyLast4: string;
  baseUrl: string | null;
  organization: string | null;
  project: string | null;
  models: string[];
  defaultModel: string | null;
  enabled: boolean;
  updatedAt: string | null;
}

export interface ProviderCatalogEntry {
  id: ProviderId;
  label: string;
  defaultBaseUrl: string | null;
}

export interface AiSettings {
  mcpEnabled: boolean;
  assistantEnabled: boolean;
  allowPrivateEndpoints: boolean;
  userDailyLimit: number | null;
  mcpRateLimit: number | null;
  mcpUrl: string;
  origin: string;
  publicHttps: boolean;
}

export interface ConnectedApp {
  id: string;
  clientId: string;
  clientName: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  capabilities: string[];
  userTools: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AvailableProvider {
  source: CredentialScope;
  provider: ProviderId;
  label: string | null;
  models: string[];
  defaultModel: string | null;
}

export interface DailyUsage {
  day: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  limit: number | null;
}

export interface AssistantStatus {
  enabled: boolean;
  allowed: boolean;
  providers: AvailableProvider[];
  usage: DailyUsage | null;
}

export type ChatContentPart = { type: "text"; text: string } | { type: "image"; mediaType: string; data: string };
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
export type ChatMessage =
  | { role: "user"; content: string | ChatContentPart[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export interface PreviewChange {
  field: string;
  before: string | null;
  after: string;
}

export type AssistantEvent =
  | { type: "text"; delta: string }
  | { type: "message"; message: ChatMessage }
  | { type: "tool_status"; name: string; title: string; ok: boolean }
  | { type: "confirm"; call: ToolCall; title: string; destructive: boolean; preview: { summary: string; changes: PreviewChange[] } }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; reason: "complete" | "awaiting_confirmation" | "step_limit" }
  | { type: "error"; error: string; kind?: string };

export interface ModelChoice {
  source: CredentialScope;
  provider: ProviderId;
  model: string;
}

export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind?: string,
  ) {
    super(message);
  }
}

export async function aiJson<T>(url: string, init?: RequestInit, fallbackError = "Request failed"): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...(init.headers ?? {}) } : init?.headers,
  });
  const body = response.status === 204 ? null : ((await response.json().catch(() => null)) as unknown);
  if (!response.ok) {
    const record = (body ?? {}) as { error?: string; kind?: string };
    throw new AiRequestError(record.error ?? fallbackError, response.status, record.kind);
  }
  return body as T;
}

/** POST a conversation and yield the assistant's NDJSON events as they arrive. */
export async function* streamAssistant(
  body: ModelChoice & { messages: ChatMessage[]; context?: string },
  signal: AbortSignal,
  fallbackError = "Request failed",
): AsyncGenerator<AssistantEvent> {
  const response = await fetch("/api/ai/assistant/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const record = ((await response.json().catch(() => null)) ?? {}) as { error?: string; kind?: string };
    throw new AiRequestError(record.error ?? fallbackError, response.status, record.kind);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line) as AssistantEvent;
      } catch {
        // Ignore a malformed line rather than abort the turn.
      }
    }
  }
}
