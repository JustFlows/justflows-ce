import { describe, expect, it } from "vitest";
import { siblingCallAllowed } from "../../../src/lib/plugins/plugin-call-site.js";

describe("sibling plugin calls", () => {
  const site = { tenantId: "workspace", status: "active", tenantStatus: "active" };

  it("allows an active site in the same workspace", () => {
    expect(siblingCallAllowed("workspace", site)).toBe(true);
  });

  it("refuses another workspace, a suspended site, and a missing tenant", () => {
    expect(siblingCallAllowed("other", site)).toBe(false);
    expect(siblingCallAllowed("workspace", { ...site, status: "suspended" })).toBe(false);
    expect(siblingCallAllowed("workspace", { ...site, tenantStatus: "suspended" })).toBe(false);
    expect(siblingCallAllowed("", site)).toBe(false);
    expect(siblingCallAllowed("workspace", null)).toBe(false);
  });
});
