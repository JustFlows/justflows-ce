// SPDX-License-Identifier: MIT

import type { PluginOutboundApi, PluginOutboundRequest, PluginOutboundResponse } from "@justflows/sdk";
import { guardedFetch, OutboundUrlError, readLimited } from "../ai/safe-fetch.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 1_048_576;
const MAX_BYTES = 10 * 1_048_576;
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

function bounded(value: number | undefined, fallback: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) : fallback;
}

/**
 * `ctx.outbound` for a plugin holding `network:outbound`: the same SSRF guard
 * and DNS pinning the host uses for agent fetches, applied to every redirect
 * hop, never to private or loopback addresses. Failures come back as values
 * so a plugin can record them without parsing error messages.
 */
export function createPluginOutboundApi(pluginId: string): PluginOutboundApi {
  return {
    async fetch(url: string, request: PluginOutboundRequest = {}): Promise<PluginOutboundResponse> {
      const method = (request.method ?? "GET").toUpperCase();
      if (!METHODS.has(method)) return { ok: false, code: "failed", error: `Method ${method} is not allowed` };
      const timeoutMs = bounded(request.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
      const maxBytes = bounded(request.maxBytes, DEFAULT_MAX_BYTES, MAX_BYTES);
      const headers: Record<string, string> = { "user-agent": `Justflows plugin ${pluginId}`, ...(request.headers ?? {}) };
      try {
        const response = await guardedFetch(url, {
          method,
          headers,
          timeoutMs,
          ...(request.body !== undefined && method !== "GET" && method !== "HEAD" ? { body: request.body } : {}),
        });
        const body = method === "HEAD" ? Buffer.alloc(0) : await readLimited(response, maxBytes);
        const out: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          if (key !== "set-cookie") out[key] = value;
        });
        return { ok: true, status: response.status, headers: out, body: body.toString("utf8"), url: response.url || url };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof OutboundUrlError) {
          return { ok: false, code: /larger than/.test(message) ? "too_large" : "blocked", error: message };
        }
        if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
          return { ok: false, code: "timeout", error: `No answer within ${timeoutMs} ms` };
        }
        return { ok: false, code: "failed", error: message.slice(0, 300) };
      }
    },
  };
}
