// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { requiresPluginCsrf } from "../plugin-http.js";

describe("requiresPluginCsrf", () => {
  it("allows the public Forms submission route without a session token", () => {
    expect(requiresPluginCsrf("POST", "/justflows-forms/submit")).toBe(false);
  });

  it("keeps CSRF protection on other plugin mutations", () => {
    expect(requiresPluginCsrf("POST", "/some-plugin/action")).toBe(true);
    expect(requiresPluginCsrf("PUT", "/justflows-forms/admin/forms/contact")).toBe(true);
    expect(requiresPluginCsrf("DELETE", "/justflows-forms/admin/submissions/1")).toBe(true);
  });

  it("does not require CSRF for read-only plugin routes", () => {
    expect(requiresPluginCsrf("GET", "/justflows-forms/config")).toBe(false);
  });
});
