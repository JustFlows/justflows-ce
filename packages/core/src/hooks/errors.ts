// SPDX-License-Identifier: MIT

/**
 * Thrown when a gate hook cancels a core operation.
 *
 * Gates fail closed: a handler that calls `cancel(reason)` — or throws — stops
 * the operation before it commits. The error always names the extension that
 * caused it so an administrator never has to guess.
 */
export class HookAbortError extends Error {
  override readonly name = "HookAbortError";

  /** The hook that was being dispatched, e.g. `content.beforeCreate`. */
  readonly hook: string;

  /** Human-readable reason, safe to surface to the end user. */
  readonly reason: string;

  /** Plugin that aborted the operation, or `null` when core did. */
  readonly pluginId: string | null;

  constructor(hook: string, reason: string, pluginId: string | null = null, cause?: unknown) {
    super(reason, cause === undefined ? undefined : { cause });
    this.hook = hook;
    this.reason = reason;
    this.pluginId = pluginId;
  }
}

export function isHookAbortError(value: unknown): value is HookAbortError {
  return value instanceof HookAbortError;
}
