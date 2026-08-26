import { afterEach, describe, expect, it, vi } from "vitest";
import { installSsrFetchCache, type AdminSsrPayload } from "./ssr-data";

const originalFetch = window.fetch;

afterEach(() => {
  window.fetch = originalFetch;
  vi.restoreAllMocks();
});

function payload(): AdminSsrPayload {
  return {
    url: "/admin/content",
    locale: "en",
    responses: {
      "/api/content": {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ title: "From SSR" }] }),
      },
    },
  };
}

describe("SSR fetch cache", () => {
  it("serves an initial GET without browser network traffic", async () => {
    const native = vi.fn().mockResolvedValue(new Response("native"));
    window.fetch = native;
    installSsrFetchCache(payload());

    const response = await fetch("/api/content");
    expect(await response.json()).toEqual({ items: [{ title: "From SSR" }] });
    expect(native).not.toHaveBeenCalled();
  });

  it("invalidates prefetched reads when a mutation begins", async () => {
    const native = vi.fn().mockResolvedValue(new Response("native"));
    window.fetch = native;
    installSsrFetchCache(payload());

    await fetch("/api/content", { method: "POST" });
    const response = await fetch("/api/content");
    expect(await response.text()).toBe("native");
    expect(native).toHaveBeenCalledTimes(2);
  });
});
