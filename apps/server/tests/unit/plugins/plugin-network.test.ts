// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { siteOrigin } from "../../../src/lib/plugins/plugin-network.js";

describe("siteOrigin", () => {
  it("uses HTTPS for a public hostname and ignores the dev port", () => {
    expect(siteOrigin("Support.Example.com", "3000")).toBe("https://support.example.com");
  });

  it("keeps plain HTTP and the dev port on a loopback name", () => {
    expect(siteOrigin("shop.localhost", "3000")).toBe("http://shop.localhost:3000");
    expect(siteOrigin("localhost", undefined)).toBe("http://localhost");
  });
});
