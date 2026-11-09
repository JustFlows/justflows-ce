// SPDX-License-Identifier: MIT

import type { CacheAdapter } from "./adapter.js";

export interface GuardedCacheOptions {
  /** A read or write slower than this counts as failed. Default 2000 ms. */
  timeoutMs?: number;
  /**
   * Limit for `invalidate` and `clear`, which may walk many keys. Default
   * 30000 ms. A bulk call that runs out of time counts as a lost invalidation.
   */
  bulkTimeoutMs?: number;
  /** Wait between recovery attempts while bypassing. Default 5000 ms. */
  retryDelayMs?: number;
  /** Told about every failed call. Must not throw. */
  onError?: (operation: CacheOperation, error: unknown) => void;
  /** Clock, for tests. */
  now?: () => number;
}

export type CacheOperation = "get" | "set" | "delete" | "invalidate" | "clear" | "has" | "recover";

/**
 * Wraps an external cache backend so its outages never fail a request or
 * serve stale data.
 *
 * - A failed or slow read is a miss; a failed write is skipped.
 * - A failed `delete`, `invalidate`, or `clear` means another process may
 *   still read an entry that should be gone. The guard then bypasses the
 *   backend (reads miss, writes skip) until a full `clear()` succeeds, and
 *   retries that `clear()` at most every `retryDelayMs`.
 */
export class GuardedCache implements CacheAdapter {
  private readonly timeoutMs: number;
  private readonly bulkTimeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly onError: (operation: CacheOperation, error: unknown) => void;
  private readonly now: () => number;
  private bypassing = false;
  private retryAt = 0;
  private recovering: Promise<boolean> | null = null;

  constructor(
    private readonly inner: CacheAdapter,
    options: GuardedCacheOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.bulkTimeoutMs = options.bulkTimeoutMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs ?? 5000;
    this.onError = options.onError ?? (() => undefined);
    this.now = options.now ?? Date.now;
  }

  /** True while the backend is bypassed after a lost invalidation. */
  get degraded(): boolean {
    return this.bypassing;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    if (!(await this.ready())) return undefined;
    try {
      return await this.run(this.inner.get<T>(key));
    } catch (error) {
      this.report("get", error);
      return undefined;
    }
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!(await this.ready())) return;
    try {
      await this.run(this.inner.set(key, value, ttlSeconds));
    } catch (error) {
      this.report("set", error);
    }
  }

  async has(key: string): Promise<boolean> {
    if (!(await this.ready())) return false;
    try {
      return await this.run(this.inner.has(key));
    } catch (error) {
      this.report("has", error);
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    /** While bypassing, the recovery `clear()` already covers this key. */
    if (!(await this.ready())) return;
    try {
      await this.run(this.inner.delete(key));
    } catch (error) {
      this.lose("delete", error);
    }
  }

  async invalidate(prefix: string): Promise<void> {
    if (!(await this.ready())) return;
    try {
      await this.run(this.inner.invalidate(prefix), this.bulkTimeoutMs);
    } catch (error) {
      this.lose("invalidate", error);
    }
  }

  async clear(): Promise<void> {
    try {
      await this.run(this.inner.clear(), this.bulkTimeoutMs);
      this.bypassing = false;
      this.retryAt = 0;
    } catch (error) {
      this.lose("clear", error);
    }
  }

  /** True when the backend may be used; while bypassing, tries one recovery `clear()`. */
  private ready(): Promise<boolean> {
    if (!this.bypassing) return Promise.resolve(true);
    if (this.recovering) return this.recovering;
    if (this.now() < this.retryAt) return Promise.resolve(false);
    this.recovering = this.run(this.inner.clear(), this.bulkTimeoutMs)
      .then(
        () => {
          this.bypassing = false;
          this.retryAt = 0;
          return true;
        },
        (error: unknown) => {
          this.report("recover", error);
          this.retryAt = this.now() + this.retryDelayMs;
          return false;
        },
      )
      .finally(() => {
        this.recovering = null;
      });
    return this.recovering;
  }

  private lose(operation: CacheOperation, error: unknown): void {
    this.report(operation, error);
    this.bypassing = true;
    this.retryAt = this.now() + this.retryDelayMs;
  }

  private report(operation: CacheOperation, error: unknown): void {
    try {
      this.onError(operation, error);
    } catch {
      /** A failing reporter must not turn a cache miss into a request error. */
    }
  }

  private async run<T>(work: Promise<T>, timeoutMs = this.timeoutMs): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Cache store did not answer within ${timeoutMs} ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
