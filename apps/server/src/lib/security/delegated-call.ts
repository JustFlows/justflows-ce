// SPDX-License-Identifier: MIT

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Work done on someone's behalf by a credential rather than by the person in
 * the admin: an MCP or assistant tool call, or a request authenticated with an
 * API key or OAuth access token.
 *
 * The host sets this itself, around the whole call, before any plugin code
 * runs, so plugin code cannot clear or skip it. Platform operations that reach
 * beyond the current site (creating, suspending or deleting workspaces,
 * changing limits) read it and refuse: an agent or key may only ever act on
 * the site it belongs to, whatever a plugin's code tries to do on its behalf.
 */
export type DelegateKind = "mcp" | "assistant" | "api-key" | "oauth";

export interface Delegate {
  kind: DelegateKind;
  /** Key or client name, for error messages and logs. */
  client: string;
}

const storage = new AsyncLocalStorage<Delegate>();

export function runAsDelegate<T>(delegate: Delegate, fn: () => T): T {
  return storage.run(delegate, fn);
}

export function currentDelegate(): Delegate | undefined {
  return storage.getStore();
}

/** Thrown when delegated work tries a platform operation. */
export class DelegatedCallRefused extends Error {
  readonly status = 403;
  constructor(action: string, delegate: Delegate) {
    super(`${action} is not allowed on behalf of ${delegate.kind === "api-key" ? "an API key" : delegate.kind === "oauth" ? "a connected app" : "an AI agent"}. A platform operator does this in the admin.`);
    this.name = "DelegatedCallRefused";
  }
}

/** Refuse `action` when the current work is delegated. */
export function refuseDelegated(action: string): void {
  const delegate = storage.getStore();
  if (delegate) throw new DelegatedCallRefused(action, delegate);
}
