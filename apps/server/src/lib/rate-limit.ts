interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

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
    if (now >= bucket.resetAt) buckets.delete(key);
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

/** Returns true when the request is allowed; false when rate limited. */
export function consumeRateLimit(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();

  if (++sinceSweep >= SWEEP_EVERY) {
    sinceSweep = 0;
    sweep(now);
  }

  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= maxAttempts) return false;

  bucket.count += 1;
  return true;
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
