// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: { download: true, erasure: true },
  open: null as null | { id: string; requestedAt: string; dueAt: string },
  exportData: vi.fn(),
  summary: vi.fn(),
  create: vi.fn(),
  cancel: vi.fn(),
  verify: vi.fn(),
  confirmed: true,
  sendConfirmation: vi.fn(),
  redeem: vi.fn(),
}));
vi.mock("../../../src/lib/database/db.js", () => ({ getDb: async () => ({ query: async () => [{ password_hash: "hash", email: "ada@example.com", display_name: "Ada", username: "ada" }] }) }));
vi.mock("../../../src/lib/auth/password.js", () => ({ verifyPassword: mocks.verify }));
vi.mock("../../../src/lib/auth/personal-data.js", () => ({ exportPersonalData: mocks.exportData, summarizePersonalData: mocks.summary }));
vi.mock("../../../src/lib/auth/data-requests.js", () => ({
  selfServiceSettings: async () => mocks.settings,
  openErasureRequest: async () => mocks.open,
  createErasureRequest: mocks.create,
  cancelErasureRequest: mocks.cancel,
  addressConfirmed: async () => mocks.confirmed,
  sendAddressConfirmation: mocks.sendConfirmation,
  redeemAddressConfirmation: mocks.redeem,
}));
vi.mock("../../../src/lib/account/pages.js", () => ({ accountDataPageUrl: async () => "/account-data" }));
import { accountDataRouter } from "../../../src/routes/public/account-data.js";

let server: Server; let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  /** The account API puts the signed-in member here before this router runs. */
  app.use((req, _res, next) => { (req as unknown as { session: object }).session = { userId: "u-1", siteId: "site-1", role: "subscriber", email: "ada@example.com" }; next(); });
  app.use("/data", accountDataRouter);
  server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/data`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
beforeEach(() => {
  mocks.settings = { download: true, erasure: true };
  mocks.open = null;
  mocks.confirmed = true;
  for (const fn of [mocks.exportData, mocks.summary, mocks.create, mocks.cancel, mocks.verify, mocks.sendConfirmation, mocks.redeem]) fn.mockReset();
});

it("shows what the site offers and counts only when the page asks", async () => {
  mocks.summary.mockResolvedValue({ content: 0, comments: 1, plugins: [] });
  expect(await (await fetch(base)).json()).toEqual({ confirmed: true, email: "ada@example.com", download: true, erasure: true, request: null, summary: null });
  expect(mocks.summary).not.toHaveBeenCalled();
  expect((await (await fetch(`${base}?summary=1`)).json() as { summary: unknown }).summary).toEqual({ content: 0, comments: 1, plugins: [] });
  expect(mocks.summary).toHaveBeenCalledWith("site-1", "u-1", { userId: "u-1", role: "subscriber" });
});

it("downloads only the member's own data, and only when the site offers it", async () => {
  mocks.exportData.mockResolvedValue({ subject: { userId: "u-1" } });
  const res = await fetch(`${base}/export?userId=someone-else`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="your-data-/);
  expect(mocks.exportData).toHaveBeenCalledWith("site-1", { userId: "u-1" }, { userId: "u-1", role: "subscriber" });
  mocks.settings = { download: false, erasure: true };
  expect((await fetch(`${base}/export`)).status).toBe(403);
});

it("asks for the password before recording a removal request", async () => {
  mocks.verify.mockResolvedValue(false);
  const post = (body: object) => fetch(`${base}/erasure-request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await post({})).status).toBe(400);
  expect((await post({ password: "wrong" })).status).toBe(403);
  expect(mocks.create).not.toHaveBeenCalled();
  mocks.verify.mockResolvedValue(true);
  mocks.create.mockResolvedValue({ ok: true, created: true, request: { id: "r-1", requestedAt: "2026-11-17T10:00:00.000Z", dueAt: "2026-12-17T10:00:00.000Z" } });
  const res = await post({ password: "right", note: " soon " });
  expect(res.status).toBe(201);
  expect(mocks.create).toHaveBeenCalledWith("site-1", { userId: "u-1", email: "ada@example.com", displayName: "Ada" }, "soon");
});

it("withdraws an open request", async () => {
  mocks.cancel.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect((await fetch(`${base}/erasure-request`, { method: "DELETE" })).status).toBe(200);
  expect((await fetch(`${base}/erasure-request`, { method: "DELETE" })).status).toBe(404);
  expect(mocks.cancel).toHaveBeenCalledWith("site-1", "u-1");
});

it("shows nothing found by address and offers no download until the member confirms their address", async () => {
  mocks.confirmed = false;
  const state = await (await fetch(`${base}?summary=1`)).json() as { confirmed: boolean; summary: unknown };
  expect(state).toMatchObject({ confirmed: false, summary: null });
  expect(mocks.summary).not.toHaveBeenCalled();
  const download = await fetch(`${base}/export`);
  expect(download.status).toBe(403);
  expect(await download.json()).toMatchObject({ code: "confirm_address" });
  expect(mocks.exportData).not.toHaveBeenCalled();
});

it("mails the confirmation link to the account's own address and accepts it only through the member's session", async () => {
  mocks.sendConfirmation.mockResolvedValue(true);
  expect((await fetch(`${base}/confirm-address`, { method: "POST" })).status).toBe(200);
  expect(mocks.sendConfirmation).toHaveBeenCalledWith("site-1", { userId: "u-1", email: "ada@example.com", displayName: "Ada" }, "/account-data");
  const verify = (token: string) => fetch(`${base}/confirm-address/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  mocks.redeem.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  expect((await verify("not-a-valid-token")).status).toBe(400);
  expect((await verify("a-valid-looking-token")).status).toBe(200);
  expect(mocks.redeem).toHaveBeenLastCalledWith("a-valid-looking-token", { siteId: "site-1", userId: "u-1", email: "ada@example.com" });
});
