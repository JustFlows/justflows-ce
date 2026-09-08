// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
let role: string | null = "administrator";
const save = vi.fn(async (_site: string, rules: unknown[], _id?: string) =>
  rules.map((r) => ({ ...(r as object), id: "bd922cab-6845-4035-bbdb-4fabbe06f87a" })),
);
const clear = vi.fn();
const list = vi.fn(async () => []);
const audit = vi.fn();
vi.mock("../../lib/auth-session.js", () => ({
  resolveSession: async () => (role ? { siteId: "s1", userId: "u1", role } : null),
}));
vi.mock("../../lib/session.js", async (original) => ({
  ...(await original<typeof import("../../lib/session.js")>()),
  syncCsrfCookie: vi.fn(),
}));
vi.mock("../../lib/redirects-db.js", () => ({
  listRedirects: () => list(),
  saveRedirects: (site: string, rules: unknown[], id?: string) => save(site, rules, id),
  listNotFound: async () => [],
  clearNotFound: () => clear(),
  redirectContext: async () => ({ history: [], content: [] }),
}));
vi.mock("../../lib/audit-log.js", () => ({
  auditFromRequest: (...args: unknown[]) => audit(...args),
}));
const { default: router } = await import("../redirects.js");
const { RedirectValidationError } = await import("../../lib/redirects.js");
let server: Server, endpoint: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/redirects", router);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/redirects`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  role = "administrator";
  vi.clearAllMocks();
});
const input = {
  source: "/old",
  kind: "exact",
  targetType: "internal",
  target: "/new",
  status: 301,
  enabled: true,
};
const send = (path: string, method: string, body?: unknown) =>
  fetch(endpoint + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
describe("redirect API", () => {
  it.each([null, "subscriber", "editor"])("protects every operation from %s", async (value) => {
    role = value;
    for (const [path, method] of [
      ["", "GET"],
      ["", "POST"],
      ["/export", "GET"],
      ["/import", "POST"],
      ["/not-found", "GET"],
      ["/not-found", "DELETE"],
      ["/bd922cab-6845-4035-bbdb-4fabbe06f87a", "PUT"],
    ]) {
      expect(
        (await send(path!, method!, method === "POST" || method === "PUT" ? input : undefined))
          .status,
      ).toBe(value ? 403 : 401);
    }
    expect(save).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
  it("creates, edits and disables using the session site and records audit entries", async () => {
    expect((await send("", "POST", input)).status).toBe(201);
    expect(save).toHaveBeenCalledWith("s1", [input], undefined);
    const id = "bd922cab-6845-4035-bbdb-4fabbe06f87a";
    expect((await send(`/${id}`, "PUT", { ...input, enabled: false })).status).toBe(200);
    expect(save).toHaveBeenLastCalledWith("s1", [{ ...input, enabled: false }], id);
    expect(audit.mock.calls.map((args) => args[1])).toEqual([
      "redirect.created",
      "redirect.updated",
    ]);
  });
  it("rejects unsafe targets, invalid IDs and query bounds before persistence", async () => {
    expect((await send("", "POST", { ...input, target: "//evil.test" })).status).toBe(400);
    expect((await send("/bad", "PUT", input)).status).toBe(400);
    expect((await send("/not-found?offset=-1", "GET")).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it("exports CSV and imports validated rows", async () => {
    const exported = await send("/export", "GET");
    expect(exported.headers.get("content-type")).toContain("text/csv");
    const header = await exported.text();
    expect(
      (await send("/import", "POST", { csv: header + "\n/old,exact,internal,/new,308,true" }))
        .status,
    ).toBe(201);
    expect(save).toHaveBeenCalledWith("s1", [{ ...input, status: 308 }], undefined);
    expect(
      (
        await send("/import", "POST", {
          csv: header + "\n/old,exact,external,javascript:bad,301,true",
        })
      ).status,
    ).toBe(400);
  });
  it("reports missing rules and loop validation without auditing success", async () => {
    save.mockRejectedValueOnce(new RedirectValidationError("Redirect not found."));
    expect((await send("/bd922cab-6845-4035-bbdb-4fabbe06f87a", "PUT", input)).status).toBe(404);
    save.mockRejectedValueOnce(new RedirectValidationError("Redirect loop."));
    expect((await send("", "POST", input)).status).toBe(400);
    expect(audit).not.toHaveBeenCalled();
  });
  it("hides database errors", async () => {
    save.mockRejectedValueOnce(new Error("private database password"));
    const response = await send("", "POST", input);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("password");
  });
});
