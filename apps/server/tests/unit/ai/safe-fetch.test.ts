// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertOutboundUrl, guardedFetch, OutboundUrlError, readLimited } from "../../../src/lib/ai/safe-fetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SSRF guard for agent fetches", () => {
  it("rejects loopback, private, link-local and metadata addresses", async () => {
    for (const url of [
      "http://127.0.0.1/x",
      "http://localhost/x",
      "http://10.0.0.5/x",
      "http://192.168.1.1/x",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/x",
      "http://printer.local/x",
    ]) {
      await expect(assertOutboundUrl(url), url).rejects.toBeInstanceOf(OutboundUrlError);
    }
  });

  it("rejects credentials, odd schemes and non-standard ports", async () => {
    await expect(assertOutboundUrl("https://user:pw@93.184.216.34/")).rejects.toThrow(/Credentials/);
    await expect(assertOutboundUrl("file:///etc/passwd")).rejects.toThrow(/HTTP or HTTPS/);
    await expect(assertOutboundUrl("http://93.184.216.34:8080/")).rejects.toThrow(/ports 80 and 443/);
  });

  it("allows a private address only when explicitly permitted (admin-approved provider URLs)", async () => {
    await expect(assertOutboundUrl("http://localhost:11434/v1", true)).resolves.toBeInstanceOf(URL);
  });

  it("re-validates every redirect hop", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(guardedFetch("https://93.184.216.34/image.jpg")).rejects.toBeInstanceOf(OutboundUrlError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses bodies over the size limit", async () => {
    const big = new Response(new Uint8Array(2048), { headers: { "content-length": "2048" } });
    await expect(readLimited(big, 1024)).rejects.toThrow(/larger than/);
    const streamed = new Response(new Uint8Array(2048));
    await expect(readLimited(streamed, 1024)).rejects.toThrow(/larger than/);
  });
});
