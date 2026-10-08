import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BlockedAddressError, pinnedFetch } from "../../../src/lib/security/pinned-fetch.js";

describe("pinned outbound fetch", () => {
  const server = createServer((_req, res) => res.end("internal"));
  let port = 0;
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("refuses to connect when the hostname resolves to loopback at connect time", async () => {
    const error = await pinnedFetch(`http://localhost:${port}/`).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).cause).toBeInstanceOf(BlockedAddressError);
  });

  it("refuses a private IP literal, which never goes through DNS", async () => {
    for (const target of [`http://127.0.0.1:${port}/`, `http://[::ffff:127.0.0.1]:${port}/`]) {
      const error = await pinnedFetch(target).catch((err: unknown) => err);
      expect((error as Error).cause).toBeInstanceOf(BlockedAddressError);
    }
  });

  it("connects to private addresses only when explicitly allowed", async () => {
    const response = await pinnedFetch(`http://localhost:${port}/`, { allowPrivate: true });
    expect(await response.text()).toBe("internal");
  });
});
