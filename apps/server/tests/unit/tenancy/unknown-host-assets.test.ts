// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { isUnknownHostPublicAsset } from "../../../src/middleware/tenant-context.js";

describe("unknown-host public assets", () => {
  it("allows only public files required by a themed website-not-found page", () => {
    for (const path of [
      "/theme.css",
      "/theme.js",
      "/theme-assets/core.heading.css",
      "/js/site-nav-abc.js",
      "/css-providers/build/dist/tailwind.css",
      "/jf-plugins.3b0e1f0821d996ae.js",
      "/uploads/site-id/image.png",
      "/favicon.ico",
    ]) {
      expect(isUnknownHostPublicAsset(path), path).toBe(true);
    }
  });

  it("keeps privileged and dynamic routes unreachable", () => {
    for (const path of [
      "/api/auth/me",
      "/admin",
      "/admin/assets/index.js",
      "/login",
      "/ext/shop/checkout",
      "/.well-known/oauth-authorization-server",
    ]) {
      expect(isUnknownHostPublicAsset(path), path).toBe(false);
    }
  });
});
