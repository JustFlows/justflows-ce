interface Bucket {
  count: number;
  resetAt: number;
  /** Consecutive windows this key has exhausted, for the backoff below. */
  strikes: number;
  /**
   * Whether this window hit its limit.
   *
   * Recorded when it happens rather than inferred later: the strike is only
   * applied on the next call after the window closes, so between those two
   * moments the sweep has to know this bucket is worth keeping. Deriving it
   * from `strikes` did not work — the first strike is still zero at that point,
   * so the bucket was swept and the history it existed to carry was lost.
   */
  exhausted: boolean;
}

const buckets = new Map<string, Bucket>();

/**
 * These counters live in this process's memory.
 *
 * Two consequences worth stating rather than discovering: they reset when the
 * app restarts, and they are not shared between workers — so a deployment
 * running N processes behind a balancer has an effective limit of N times what
 * the caller asked for. Both are acceptable for a single-process self-hosted
 * install, which is the deployment this ships for. A cluster wants a shared
 * store, and that is a deliberate piece of work, not a default.
 */

/**
 * Keys are attacker-chosen (an email address, an IP), so the map has to be
 * bounded or a stream of unique login attempts grows it until the process runs
 * out of memory. Expired entries are swept periodically, and the hard cap drops
 * the oldest entries if a burst outruns the sweep.
 */
const MAX_BUCKETS = 50_000;
const SWEEP_EVERY = 5_000;
let sinceSweep = 0;

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    // Keep an exhausted bucket a while past its window so the strike count
    // survives; dropping it immediately would reset the backoff every time.
    const expiry = bucket.exhausted ? bucket.resetAt + BACKOFF_MEMORY_MS : bucket.resetAt;
    if (now >= expiry) buckets.delete(key);
  }
  if (buckets.size > MAX_BUCKETS) {
    // Map iterates in insertion order, so this drops the least recently created.
    const excess = buckets.size - MAX_BUCKETS;
    let dropped = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

/** How long a strike is remembered after its window closes. */
const BACKOFF_MEMORY_MS = 60 * 60 * 1000;
/** Ceiling on the doubling, so a key cannot be locked out for a day. */
const MAX_BACKOFF_MULTIPLIER = 8;

/**
 * Returns true when the request is allowed; false when rate limited.
 *
 * A caller that exhausts its window gets a longer next one — doubling per
 * consecutive strike, up to eight times the base. A flat window lets an
 * attacker run at exactly the limit indefinitely: 10 guesses every 15 minutes
 * is 960 a day, forever, at no cost. The backoff makes sustained guessing
 * progressively more expensive while leaving a person who mistypes their
 * password twice completely unaffected.
 */
export function consumeRateLimit(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();

  if (++sinceSweep >= SWEEP_EVERY) {
    sinceSweep = 0;
    sweep(now);
  }

  const bucket = buckets.get(key);

  if (!bucket) {
    buckets.set(key, { count: 1, resetAt: now + windowMs, strikes: 0, exhausted: false });
    return true;
  }

  if (now >= bucket.resetAt) {
    // Window closed. If the last one was exhausted, the next one is longer.
    const strikes = bucket.exhausted ? Math.min(bucket.strikes + 1, 30) : 0;
    const multiplier = Math.min(2 ** strikes, MAX_BACKOFF_MULTIPLIER);
    buckets.set(key, {
      count: 1,
      resetAt: now + windowMs * multiplier,
      strikes,
      exhausted: false,
    });
    return true;
  }

  if (bucket.count >= maxAttempts) {
    bucket.exhausted = true;
    return false;
  }

  bucket.count += 1;
  if (bucket.count >= maxAttempts) bucket.exhausted = true;
  return true;
}

/** Seconds until this key may try again, for a Retry-After header. */
export function rateLimitRetryAfter(key: string): number {
  const bucket = buckets.get(key);
  if (!bucket) return 0;
  return Math.max(0, Math.ceil((bucket.resetAt - Date.now()) / 1000));
}

/** Test seam: drop all counters. */
export function resetRateLimits(): void {
  buckets.clear();
  sinceSweep = 0;
}

/** Test seam: current bucket count. */
export function rateLimitBucketCount(): number {
  return buckets.size;
}

export function clientIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}
