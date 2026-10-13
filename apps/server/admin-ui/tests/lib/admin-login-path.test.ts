// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it } from "vitest";
import { adminAuthPage, isPreAuthPath } from "../../src/admin-path";
import { setAdminSsrPayload } from "../../src/ssr-data";

afterEach(() => setAdminSsrPayload(null));

describe("staff auth pages under the admin path", () => {
  it.each([
    ["/admin/login", "/admin", "login"],
    ["/control-room/login", "/control-room", "login"],
    ["/control-room/forgot-password", "/control-room", "forgot-password"],
    ["/private/desk/reset-password/", "/private/desk", "reset-password"],
  ])("reads %s", (pathname, base, page) => {
    expect(adminAuthPage(pathname)).toEqual({ base, page });
    expect(isPreAuthPath(pathname)).toBe(true);
  });

  it.each(["/login", "/forgot-password", "/control-room", "/control-room/register", "/control-room/login/extra", "//evil/login", "/a b/login"])(
    "does not treat %s as a staff auth page",
    (pathname) => {
      expect(adminAuthPage(pathname)).toBeNull();
    },
  );

  it("ignores a signed-in admin page whose route ends in /login", () => {
    setAdminSsrPayload({ adminBasePath: "/control-room", url: "/control-room/plugins/x/login", locale: "en", responses: {} });
    expect(adminAuthPage("/control-room/plugins/x/login")).toBeNull();
  });
});
