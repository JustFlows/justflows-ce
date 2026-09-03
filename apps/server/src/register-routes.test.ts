// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { ADMIN_PAGE_PATH_RE } from "./register-routes.js";

describe("admin SPA route matching", () => {
  it.each(["/admin", "/admin/", "/admin/content", "/admin/content/new"])(
    "serves the SPA document for %s",
    (pathname) => {
      expect(ADMIN_PAGE_PATH_RE.test(pathname)).toBe(true);
    },
  );

  it.each(["/administrator", "/api/admin", "/"])("does not claim %s", (pathname) => {
    expect(ADMIN_PAGE_PATH_RE.test(pathname)).toBe(false);
  });
});
