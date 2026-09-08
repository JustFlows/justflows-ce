import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Mirrors the `public/` static handler in server.ts: a long max-age for the
// directory, but theme runtime scripts/styles downgraded to `no-cache` so an
// edit to e.g. site-nav.js is picked up without a hard refresh.
const publicDir = path.resolve(fileURLToPath(import.meta.url), "../../../../../../public");

let server: http.Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(
    express.static(publicDir, {
      maxAge: 86400_000,
      setHeaders: (res, filePath) => {
        if (/\.(?:js|mjs|css)$/i.test(filePath)) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(() => {
  server?.close();
});

describe("public/ static cache headers", () => {
  it("serves the theme runtime JS with a revalidating policy, not a day-long max-age", async () => {
    const res = await fetch(`${base}/js/site-nav.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    // ETag is still emitted, so unchanged files revalidate cheaply (304).
    expect(res.headers.get("etag")).toBeTruthy();
  });
});
