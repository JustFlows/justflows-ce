// SPDX-License-Identifier: MIT

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { admitUpload, createKeyedLock, createSemaphore } from "../../../src/lib/security/upload-admission.js";

function fakeRequest(siteId: string, contentLength?: number) {
  return {
    session: { siteId },
    get: (name: string) => (name === "content-length" && contentLength !== undefined ? String(contentLength) : undefined),
  } as never;
}

function fakeResponse() {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    set: () => res,
    json: vi.fn(() => res),
  });
  return res;
}

describe("upload admission", () => {
  it("refuses a declared body over the limit before reading it", () => {
    const admit = admitUpload({ name: "t1", maxBytes: 1024, perSite: 2, global: 4 });
    const res = fakeResponse();
    const next = vi.fn();
    admit(fakeRequest("a", 10 * 1024 * 1024), res as never, next);
    expect(res.statusCode).toBe(413);
    expect(next).not.toHaveBeenCalled();
  });

  it("caps uploads in flight per site and frees the slot when the response ends", () => {
    const admit = admitUpload({ name: "t2", maxBytes: 1024, perSite: 1, global: 4 });
    const first = fakeResponse();
    const next = vi.fn();
    admit(fakeRequest("a"), first as never, next);
    const second = fakeResponse();
    admit(fakeRequest("a"), second as never, next);
    expect(second.statusCode).toBe(429);
    // Another site is unaffected.
    admit(fakeRequest("b"), fakeResponse() as never, next);
    expect(next).toHaveBeenCalledTimes(2);

    first.emit("close");
    admit(fakeRequest("a"), fakeResponse() as never, next);
    expect(next).toHaveBeenCalledTimes(3);
  });
});

describe("work limits", () => {
  it("never runs more than the limit at once", async () => {
    const run = createSemaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        run(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it("serialises work per key so a budget check cannot race", async () => {
    const withLock = createKeyedLock();
    let budget = 1;
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        withLock("site", async () => {
          if (budget < 1) return false;
          await new Promise((resolve) => setTimeout(resolve, 2));
          budget -= 1;
          return true;
        }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
