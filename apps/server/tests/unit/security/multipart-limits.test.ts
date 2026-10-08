// SPDX-License-Identifier: MIT

import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import multer from "multer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admitUpload, multipartLimits, withMultipartErrors } from "../../../src/lib/security/upload-admission.js";

const BOUNDARY = "jfboundary";
let server: http.Server;
let port = 0;
let handled = 0;

beforeAll(async () => {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: multipartLimits(64 * 1024) });
  app.post(
    "/upload",
    (req, _res, next) => {
      (req as { session?: { siteId: string } }).session = { siteId: "site-a" };
      next();
    },
    admitUpload({ name: "test-multipart", maxBytes: 64 * 1024, perSite: 4, global: 8 }),
    withMultipartErrors(upload.single("file")),
    (_req, res) => {
      handled += 1;
      res.json({ ok: true });
    },
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** Send a chunked multipart body (no Content-Length) and return the status. */
function sendChunked(parts: Buffer[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/upload",
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}`, "transfer-encoding": "chunked" },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", (err: NodeJS.ErrnoException) => (err.code === "ECONNRESET" || err.code === "EPIPE" ? resolve(413) : reject(err)));
    for (const part of parts) req.write(part);
    req.end();
  });
}

function field(name: string, value: string): Buffer {
  return Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
}

function file(content: Buffer): Buffer[] {
  return [
    Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ];
}

describe("multipart limits", () => {
  it("refuses large text fields sent in a chunked body", async () => {
    const before = handled;
    const status = await sendChunked([
      field("a", "x".repeat(700_000)),
      field("b", "x".repeat(700_000)),
      field("c", "x".repeat(700_000)),
      ...file(Buffer.from("1")),
    ]);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(handled).toBe(before);
  });

  it("refuses too many small fields", async () => {
    const before = handled;
    const many = Array.from({ length: 50 }, (_, i) => field(`f${i}`, "x"));
    expect(await sendChunked([...many, ...file(Buffer.from("1"))])).toBe(400);
    expect(handled).toBe(before);
  });

  it("stops a chunked body that grows past the budget without a Content-Length", async () => {
    const before = handled;
    const chunks = Array.from({ length: 40 }, () => Buffer.alloc(64 * 1024, 120));
    expect(await sendChunked([...file(Buffer.concat(chunks))])).toBe(413);
    expect(handled).toBe(before);
  });

  it("still accepts a normal upload", async () => {
    expect(await sendChunked(file(Buffer.from("hello")))).toBe(200);
  });
});
