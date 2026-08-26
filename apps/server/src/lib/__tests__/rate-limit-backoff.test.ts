import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeRateLimit, rateLimitRetryAfter, resetRateLimits } from "../rate-limit.js";

const WINDOW = 15 * 60 * 1000;
const MAX = 3;

/** Burn a whole window, returning how many attempts were allowed. */
function burn(key: string): number {
  let allowed = 0;
  for (let i = 0; i < MAX + 2; i++) if (consumeRateLimit(key, MAX, WINDOW)) allowed++;
  return allowed;
}

beforeEach(() => {
  resetRateLimits();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("fixed window", () => {
  it("allows exactly the quota, then refuses", () => {
    expect(burn("k")).toBe(MAX);
  });

  it("lets an innocent caller through again after the window", () => {
    // Two failed attempts is not a strike — the window was never exhausted.
    expect(consumeRateLimit("k", MAX, WINDOW)).toBe(true);
    expect(consumeRateLimit("k", MAX, WINDOW)).toBe(true);
    vi.advanceTimersByTime(WINDOW + 1);
    expect(consumeRateLimit("k", MAX, WINDOW)).toBe(true);
    expect(rateLimitRetryAfter("k")).toBeLessThanOrEqual(WINDOW / 1000);
  });
});

describe("progressive backoff", () => {
  it("doubles the window for each consecutive exhausted one", () => {
    burn("attacker");                       // strike 1
    vi.advanceTimersByTime(WINDOW + 1);
    burn("attacker");                       // strike 2 -> next window x2
    vi.advanceTimersByTime(WINDOW + 1);

    // The x2 window has not closed yet, so the attacker is still shut out.
    expect(consumeRateLimit("attacker", MAX, WINDOW)).toBe(false);
    vi.advanceTimersByTime(WINDOW + 1);
    expect(consumeRateLimit("attacker", MAX, WINDOW)).toBe(true);
  });

  it("caps the multiplier so a key is never locked out indefinitely", () => {
    for (let round = 0; round < 12; round++) {
      burn("persistent");
      vi.advanceTimersByTime(WINDOW * 16);
    }
    // Even after twelve exhausted windows, 16x the base window always reopens.
    expect(consumeRateLimit("persistent", MAX, WINDOW)).toBe(true);
  });

  it("clears the strike count once a window is not exhausted", () => {
    burn("recovering");                     // strike 1
    vi.advanceTimersByTime(WINDOW * 2 + 1);
    expect(consumeRateLimit("recovering", MAX, WINDOW)).toBe(true);  // uses 1 of 3
    vi.advanceTimersByTime(WINDOW * 2 + 1);

    // Back to a plain window: exhausting it now is strike 1 again, not 3.
    burn("recovering");
    vi.advanceTimersByTime(WINDOW * 2 + 1);
    expect(consumeRateLimit("recovering", MAX, WINDOW)).toBe(true);
  });

  it("keeps keys independent", () => {
    burn("a");
    vi.advanceTimersByTime(WINDOW + 1);
    burn("a");
    // b has never been throttled and must be unaffected by a's history.
    expect(consumeRateLimit("b", MAX, WINDOW)).toBe(true);
  });
});

describe("bounded memory", () => {
  it("does not grow without limit on attacker-chosen keys", async () => {
    const { rateLimitBucketCount } = await import("../rate-limit.js");
    // Keys are attacker-chosen (an email, an IP), so a stream of unique values
    // must not grow the map without bound. The sweep trims to the cap and the
    // triggering insert lands after it, so the steady state sits just above.
    for (let i = 0; i < 60_000; i++) consumeRateLimit(`k${i}`, MAX, 1);
    const size = rateLimitBucketCount();
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(50_010);
  });

  it("retains a strike long enough for the backoff to bite", () => {
    burn("striker");
    vi.advanceTimersByTime(WINDOW + 1);
    // Sweeping must not drop the bucket the moment its window closes, or the
    // strike count resets and the backoff never escalates.
    for (let i = 0; i < 6000; i++) consumeRateLimit(`noise${i}`, MAX, 1);
    burn("striker");
    vi.advanceTimersByTime(WINDOW + 1);
    expect(consumeRateLimit("striker", MAX, WINDOW)).toBe(false);
  });
});
