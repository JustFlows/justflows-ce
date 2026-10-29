// SPDX-License-Identifier: MIT

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { rateLimit } from "express-rate-limit";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/routes/public/public-site.js", () => ({
  sendPublicRateLimited: async (_req: express.Request, res: express.Response) => {
    res.status(429).type("html").send("limited");
  },
}));

const { publicPageRateLimit } = await import("../../../src/middleware/public-page-rate-limit.js");

function policyNames(header: string | null): string[] {
  return [...(header ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
}

describe("public page rate limit", () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    const app = express();
    const pass: express.RequestHandler = (_req, _res, next) => next();
    app.use(publicPageRateLimit, pass);
    app.use(publicPageRateLimit, pass);
    app.use(publicPageRateLimit);
    app.get(
      "/search",
      rateLimit({
        windowMs: 60_000,
        limit: 60,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        identifier: "search",
      }),
      (_req, res) => {
        res.type("text").send("search");
      },
    );
    app.get("/", (_req, res) => {
      res.type("html").send("ok");
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("writes the public policy once and keeps a tighter limit under its own name", async () => {
    const page = await fetch(origin);
    expect(page.status).toBe(200);
    expect(policyNames(page.headers.get("ratelimit"))).toEqual(["public"]);
    expect(policyNames(page.headers.get("ratelimit-policy"))).toEqual(["public"]);

    const again = await fetch(origin);
    const firstRemaining = Number(/r=(\d+)/.exec(page.headers.get("ratelimit") ?? "")?.[1]);
    const secondRemaining = Number(/r=(\d+)/.exec(again.headers.get("ratelimit") ?? "")?.[1]);
    expect(secondRemaining).toBe(firstRemaining - 1);

    const search = await fetch(`${origin}/search`);
    expect(policyNames(search.headers.get("ratelimit"))).toEqual(["public", "search"]);
    expect(policyNames(search.headers.get("ratelimit-policy"))).toEqual(["public", "search"]);
  });

  it("stops the client when the shared allowance is spent and renders the public limit page", async () => {
    const limited = express();
    limited.use(publicPageRateLimit, (_req, res) => {
      res.type("html").send("ok");
    });
    const extra = limited.listen(0);
    await new Promise<void>((resolve) => extra.once("listening", resolve));
    const base = `http://127.0.0.1:${(extra.address() as AddressInfo).port}`;
    try {
      const first = await fetch(base);
      expect(first.status).toBe(200);
      const remaining = Number(/r=(\d+)/.exec(first.headers.get("ratelimit") ?? "")?.[1]);
      expect(remaining).toBeGreaterThan(0);
      for (let i = 0; i < remaining; i += 1) {
        expect((await fetch(base)).status).toBe(200);
      }
      const blocked = await fetch(base);
      expect(blocked.status).toBe(429);
      expect(await blocked.text()).toBe("limited");
      expect(policyNames(blocked.headers.get("ratelimit"))).toEqual(["public"]);
    } finally {
      await new Promise<void>((resolve) => extra.close(() => resolve()));
    }
  }, 30_000);
});
