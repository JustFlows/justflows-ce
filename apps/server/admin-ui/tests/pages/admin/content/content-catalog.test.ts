// SPDX-License-Identifier: MIT
import { afterEach, expect, it, vi } from "vitest";
import { loadContentCatalog } from "../../../../src/lib/content-catalog";

afterEach(() => vi.unstubAllGlobals());
it("loads older pages beyond a full first batch with one request per batch", async () => {
  const first = Array.from({ length: 100 }, (_, i) => ({ id: `post-${i}`, type: "post" }));
  const older = [{ id: "older-home-nl", type: "page" }, { id: "older-about", type: "page" }];
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ items: first, nextCursor: "post-99" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ items: older, nextCursor: null }) });
  vi.stubGlobal("fetch", fetchMock);
  const rows = await loadContentCatalog<{ id: string; type: string }>(new AbortController().signal);
  expect(rows.filter(row => row.type === "page")).toEqual(older);
  expect(rows).toHaveLength(102);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toBe("/api/content?limit=100&cursor=post-99");
});
it("rejects a failed later batch rather than presenting a complete catalog", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: "one" }], nextCursor: "one" }) }).mockResolvedValueOnce({ ok: false }));
  await expect(loadContentCatalog(new AbortController().signal)).rejects.toThrow("unavailable");
});
it("stops on a repeated cursor", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [], nextCursor: "same" }) });
  vi.stubGlobal("fetch", fetchMock);
  await expect(loadContentCatalog(new AbortController().signal)).rejects.toThrow("Repeated");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
