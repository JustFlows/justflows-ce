// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginOutboundApi } from "../../../src/lib/plugins/plugin-outbound.js";

/** Route pinned requests back to the stubbed global fetch, as the safe-fetch tests do. */
vi.mock("../../../src/lib/security/pinned-fetch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/lib/security/pinned-fetch.js")>()),
  pinnedFetch: (url: URL | string, { allowPrivate: _allowPrivate, ...init }: RequestInit & { allowPrivate?: boolean } = {}) =>
    fetch(url, init),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ctx.outbound", () => {
  it("returns the status, headers without cookies, and text body", async () => {
    const fetchMock = vi.fn(async () => new Response("BEGIN:VCALENDAR", { status: 200, headers: { "content-type": "text/calendar", "set-cookie": "a=b" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await createPluginOutboundApi("acme.cal").fetch("https://93.184.216.34/cal.ics");
    expect(result).toMatchObject({ ok: true, status: 200, body: "BEGIN:VCALENDAR" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.headers["content-type"]).toBe("text/calendar");
    expect(result.headers["set-cookie"]).toBeUndefined();
    const init = (fetchMock.mock.calls[0] as unknown as [unknown, RequestInit])[1];
    expect((init.headers as Record<string, string>)["user-agent"]).toContain("acme.cal");
  });

  it("refuses private addresses and redirects to them without throwing", async () => {
    const api = createPluginOutboundApi("acme.cal");
    expect(await api.fetch("http://127.0.0.1/x")).toMatchObject({ ok: false, code: "blocked" });
    expect(await api.fetch("http://169.254.169.254/latest/meta-data")).toMatchObject({ ok: false, code: "blocked" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://10.0.0.1/" } })));
    expect(await api.fetch("https://93.184.216.34/cal.ics")).toMatchObject({ ok: false, code: "blocked" });
  });

  it("reports bodies over the limit and unknown methods", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(4096))));
    const api = createPluginOutboundApi("acme.cal");
    expect(await api.fetch("https://93.184.216.34/big", { maxBytes: 1024 })).toMatchObject({ ok: false, code: "too_large" });
    expect(await api.fetch("https://93.184.216.34/x", { method: "TRACE" as never })).toMatchObject({ ok: false, code: "failed" });
  });
});
