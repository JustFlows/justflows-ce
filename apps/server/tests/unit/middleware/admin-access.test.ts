import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";

const adminPath = vi.hoisted(() => ({ path: "/admin" }));
vi.mock("../../../src/lib/admin/admin-path.js", () => ({
  getAdminPathConfig: async () => ({ path: adminPath.path, oldPathBehavior: "not_found" }),
}));

const { adminAccessGate } = await import("../../../src/middleware/admin-access.js");
const { createSessionToken } = await import("../../../src/lib/auth/session.js");

function cookieFor(role: string): string {
  return createSessionToken({ userId: "u1", siteId: "s1", role, email: "u@example.com", tv: 0 });
}

function fakeReq(path: string, cookieValue?: string): Request {
  return {
    path,
    cookies: cookieValue ? { jf_session: cookieValue } : {},
  } as unknown as Request;
}

function fakeRes() {
  return { redirect: vi.fn(), setHeader: vi.fn() } as unknown as Response & {
    redirect: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };
}

describe("adminAccessGate", () => {
  it("redirects to the admin sign-in page when there is no session", async () => {
    adminPath.path = "/admin";
    const req = fakeReq("/admin");
    const res = fakeRes();
    const next = vi.fn();

    adminAccessGate(req, res, next);

    await vi.waitFor(() => expect(res.redirect).toHaveBeenCalledWith("/admin/login"));
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(res.setHeader).toHaveBeenCalledWith("CDN-Cache-Control", "no-store");
    expect(next).not.toHaveBeenCalled();
  });

  it("sends a visitor of a moved admin to the hidden sign-in, never the public /login", async () => {
    adminPath.path = "/control-room";
    const res = fakeRes();
    adminAccessGate(fakeReq("/admin"), res, vi.fn());
    await vi.waitFor(() => expect(res.redirect).toHaveBeenCalledWith("/control-room/login"));
    expect(res.redirect).not.toHaveBeenCalledWith("/login");
    adminPath.path = "/admin";
  });

  it("redirects a subscriber to the site instead of the dashboard", async () => {
    const req = fakeReq("/admin", cookieFor("subscriber"));
    const res = fakeRes();
    const next = vi.fn();

    adminAccessGate(req, res, next);

    await vi.waitFor(() => expect(res.redirect).toHaveBeenCalledWith("/"));
    expect(next).not.toHaveBeenCalled();
  });

  it("redirects a subscriber on any admin sub-page, not just the dashboard", async () => {
    const req = fakeReq("/admin/users", cookieFor("subscriber"));
    const res = fakeRes();
    const next = vi.fn();

    adminAccessGate(req, res, next);

    await vi.waitFor(() => expect(res.redirect).toHaveBeenCalledWith("/"));
  });

  it.each(["administrator", "editor", "author", "contributor"])("lets a %s through", (role) => {
    const req = fakeReq("/admin", cookieFor(role));
    const res = fakeRes();
    const next = vi.fn();

    adminAccessGate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("never redirects a static asset request, even for a subscriber", () => {
    const req = fakeReq("/admin/assets/index.js", cookieFor("subscriber"));
    const res = fakeRes();
    const next = vi.fn();

    adminAccessGate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
