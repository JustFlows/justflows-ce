interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Returns true when the request is allowed; false when rate limited. */
export function consumeRateLimit(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= maxAttempts) return false;

  bucket.count += 1;
  return true;
}

export function clientIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}
