// SPDX-License-Identifier: MIT

import { guardedFetch, OutboundUrlError, readLimited } from "../safe-fetch.js";
import { ProviderError, type ProviderConfig } from "./types.js";

/**
 * Shared HTTP plumbing for provider adapters: SSRF-guarded requests, provider
 * errors mapped to user-safe messages, and a Server-Sent Events reader.
 */

export function apiRoot(config: ProviderConfig, fallback: string | null): string {
  const root = (config.baseUrl?.trim() || fallback || "").replace(/\/+$/, "");
  if (!root) throw new ProviderError("endpoint", "This provider needs a base URL.");
  return root;
}

function messageFor(status: number, body: string): ProviderError {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403) return new ProviderError("invalid_key", "The provider rejected the API key.");
  if (status === 402 || /insufficient_quota|credit balance|billing|quota/.test(lower)) {
    return new ProviderError("quota", "The provider account is out of quota or credit.");
  }
  if (status === 404 || /model[_ ]not[_ ]found|does not exist|unknown model|not_found_error/.test(lower)) {
    return new ProviderError("model", "The selected model is not available for this key.");
  }
  if (status === 429) return new ProviderError("rate_limit", "The provider is rate limiting requests. Try again shortly.");
  if (status >= 500) return new ProviderError("network", "The provider had a server error. Try again shortly.");
  return new ProviderError("other", `The provider refused the request (HTTP ${status}).`);
}

export async function providerFetch(
  config: ProviderConfig,
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; timeoutMs?: number },
): Promise<Response> {
  let response: Response;
  try {
    response = await guardedFetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      signal: init.signal,
      timeoutMs: init.timeoutMs ?? 120_000,
      allowPrivate: config.allowPrivate === true,
    });
  } catch (err) {
    if (err instanceof OutboundUrlError) throw new ProviderError("endpoint", err.message);
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new ProviderError("network", init.signal?.aborted ? "Stopped." : "The provider did not respond in time.");
    }
    throw new ProviderError("network", "Could not reach the provider.");
  }
  if (!response.ok) {
    const text = (await readLimited(response, 64_000).catch(() => Buffer.alloc(0))).toString("utf8");
    throw messageFor(response.status, text);
  }
  return response;
}

export async function providerJson<T>(response: Response): Promise<T> {
  const text = (await readLimited(response, 4 * 1024 * 1024)).toString("utf8");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError("other", "The provider returned an unreadable response.");
  }
}

/** Yield each SSE event's `data` (and `event` name) from a streaming response. */
export async function* readSse(response: Response): AsyncGenerator<{ event: string | null; data: string }> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | null = null;
  let data: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line === "") {
          if (data.length) yield { event, data: data.join("\n") };
          event = null;
          data = [];
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        } else if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        }
      }
    }
    if (data.length) yield { event, data: data.join("\n") };
  } finally {
    reader.releaseLock();
  }
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
