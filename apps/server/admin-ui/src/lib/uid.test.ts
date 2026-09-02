import { afterEach, describe, expect, it, vi } from "vitest";
import { uid } from "./uid";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uid", () => {
  it("returns a v4 UUID and unique values", () => {
    const a = uid();
    const b = uid();
    expect(a).toMatch(UUID_RE);
    expect(a).not.toBe(b);
  });

  it("falls back to getRandomValues when randomUUID is missing (non-secure context)", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: real.getRandomValues.bind(real),
    } as Crypto);
    expect(uid()).toMatch(UUID_RE);
  });

  it("still produces an id when Web Crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    expect(uid()).toEqual(expect.stringMatching(/^id-/));
  });
});
