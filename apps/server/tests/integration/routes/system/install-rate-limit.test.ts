// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";

// An installed site answers the install request at once, which keeps this test
// fast: the limiter runs before the handler either way.
process.env.STATE = "INSTALLED";

const { default: installRoutes } = await import("../../../../src/routes/system/install.js");

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/install", installRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/install`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))));

it("limits install requests, so the setup key cannot be guessed at speed", async () => {
  const send = () => fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  for (let i = 0; i < 20; i++) expect((await send()).status).toBe(200);
  const limited = await send();
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({ error: "Too many installation attempts. Try again later." });
});
