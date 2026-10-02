// SPDX-License-Identifier: MIT

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Where the current write came from, when it did not come from a person
 * clicking in the admin.
 *
 * MCP and assistant tool calls run the ordinary management API handlers
 * in-process, so the shared service layer cannot tell them apart from any
 * other key-authenticated request. The tool dispatcher runs each call inside
 * this store; the revision writer reads it to stamp `via` / `via_client`, so
 * history can show "Edited by Dirk via Claude" without threading a parameter
 * through every content service.
 */
export type AgentVia = "mcp" | "assistant";

export interface AgentOrigin {
  via: AgentVia;
  /** Client display name: an OAuth client name, an API key name, or "Assistant". */
  client: string;
}

const storage = new AsyncLocalStorage<AgentOrigin>();

export function runWithAgentOrigin<T>(origin: AgentOrigin, fn: () => Promise<T>): Promise<T> {
  return storage.run(origin, fn);
}

export function currentAgentOrigin(): AgentOrigin | undefined {
  return storage.getStore();
}

/** Column values for `revisions.via` / `revisions.via_client`. */
export function agentOriginColumns(): [string | null, string | null] {
  const origin = storage.getStore();
  if (!origin) return [null, null];
  return [origin.via, origin.client.replace(/[\r\n\0]/g, " ").trim().slice(0, 120) || null];
}
