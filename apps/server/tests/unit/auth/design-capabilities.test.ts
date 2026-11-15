// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { ROLE_CAPABILITIES, USER_CAPABILITIES } from "@justflows/sdk";
import { keyHolds } from "../../../src/lib/auth/api-keys.js";

/**
 * Design capabilities (justflows-ce#314): built-in roles keep exactly the
 * design access they had, and API keys made before the capabilities existed
 * keep working.
 */
describe("design capabilities", () => {
  it("are public capabilities", () => {
    expect(USER_CAPABILITIES).toContain("design:read");
    expect(USER_CAPABILITIES).toContain("design:manage");
  });

  it("go to the roles that had design access before", () => {
    const holders = (capability: string) => Object.keys(ROLE_CAPABILITIES).filter((role) => ROLE_CAPABILITIES[role]!.includes(capability));
    /** Writes were administrator and editor; reads were every admin-area role. */
    expect(holders("design:manage").sort()).toEqual(["administrator", "editor"]);
    expect(holders("design:read").sort()).toEqual(["administrator", "author", "contributor", "editor"]);
  });

  it("are held by a key made before them through the capability that guarded design", () => {
    const none = new Set<string>();
    expect(keyHolds({ capabilities: ["settings:manage"] }, "design:manage", none)).toBe(true);
    expect(keyHolds({ capabilities: ["content:read"] }, "design:read", none)).toBe(true);
    expect(keyHolds({ capabilities: ["content:read"] }, "design:manage", none)).toBe(false);
    expect(keyHolds({ capabilities: ["design:manage"] }, "design:manage", none)).toBe(true);
    /** The alias only covers design; it does not widen anything else. */
    expect(keyHolds({ capabilities: ["design:manage"] }, "settings:manage", none)).toBe(false);
  });
});
