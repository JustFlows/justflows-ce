/**
 * Generate a UUID-shaped id that also works outside a secure context.
 *
 * `crypto.randomUUID()` is only defined when the page is a "secure context"
 * (HTTPS, or a localhost-family host). Serving the admin UI from a bare host
 * such as http://0.0.0.0:3000 leaves it `undefined`, which crashed any page
 * that mints ids during render — most visibly the Forms builder, which
 * rendered a blank screen with `crypto.randomUUID is not a function`.
 *
 * `crypto.getRandomValues()` is not gated on secure context, so the fallback
 * stays cryptographically strong; the last resort only runs when there is no
 * Web Crypto at all.
 */
export function uid(): string {
  const c: Crypto | undefined = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;

  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }

  if (c && typeof c.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }

  return `id-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}
