// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

/** The administrator MFA policy and enrolment gate (justflows-ce#54). */
const state = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  passkeyModes: {} as Record<string, string>,
  totp: new Set<string>(),
  passkeys: {} as Record<string, number>,
}));

vi.mock("../../../src/lib/settings/site-settings.js", () => ({
  getSiteSetting: async (_siteId: string, key: string) => state.settings.get(key) ?? null,
  setSiteSetting: async (_siteId: string, key: string, value: unknown) => void state.settings.set(key, value),
}));
vi.mock("../../../src/lib/auth/webauthn/ceremonies.js", () => ({ homeSiteOf: async () => "site-1" }));
vi.mock("../../../src/lib/auth/totp-db.js", () => ({ getTotpState: async (userId: string) => ({ enabled: state.totp.has(userId) }) }));
vi.mock("../../../src/lib/auth/webauthn/passkeys-db.js", () => ({ countPasskeys: async (userId: string) => state.passkeys[userId] ?? 0 }));
vi.mock("../../../src/lib/auth/webauthn/passkey-policy.js", () => ({
  getPasskeyPolicy: async () => ({}),
  modeForRole: (_policy: unknown, role: string) => state.passkeyModes[role] ?? "allow",
}));

const policy = await import("../../../src/lib/auth/mfa-policy.js");

let n = 0;
/** A fresh site and user per test, so the module's short caches never leak between tests. */
function session(role: string) {
  n += 1;
  return { userId: `user-${n}`, siteId: `site-${n}`, role };
}

beforeEach(() => {
  state.settings.clear();
  state.passkeyModes = {};
  state.totp.clear();
  state.passkeys = {};
});

describe("MFA policy", () => {
  it("normalizes stored values and rejects invalid role ids", async () => {
    expect(policy.normalizeMfaPolicy(null)).toEqual({ requiredRoles: [] });
    expect(policy.normalizeMfaPolicy({ requiredRoles: ["administrator", "administrator"] })).toEqual({ requiredRoles: ["administrator"] });
    expect(policy.normalizeMfaPolicy({ requiredRoles: ["Not A Role!"] })).toEqual({ requiredRoles: [] });
    await expect(policy.saveMfaPolicy("site-x", { requiredRoles: ["bad role"] })).rejects.toThrow();
  });

  it("asks nothing of roles the policy does not name", async () => {
    await policy.saveMfaPolicy("site-a", { requiredRoles: ["administrator"] });
    expect(await policy.enrolmentRequirement({ userId: "editor-1", siteId: "site-a", role: "editor" })).toBeNull();
  });

  it("requires a factor for named roles, and either an authenticator app or a passkey satisfies it", async () => {
    const s = session("administrator");
    await policy.saveMfaPolicy(s.siteId, { requiredRoles: ["administrator"] });
    expect(await policy.enrolmentRequirement(s)).toBe("mfa");

    const withTotp = session("administrator");
    await policy.saveMfaPolicy(withTotp.siteId, { requiredRoles: ["administrator"] });
    state.totp.add(withTotp.userId);
    expect(await policy.enrolmentRequirement(withTotp)).toBeNull();

    const withPasskey = session("administrator");
    await policy.saveMfaPolicy(withPasskey.siteId, { requiredRoles: ["administrator"] });
    state.passkeys[withPasskey.userId] = 1;
    expect(await policy.enrolmentRequirement(withPasskey)).toBeNull();
  });

  it("enforces the passkey policy's require mode on the server", async () => {
    state.passkeyModes.editor = "require";
    const s = session("editor");
    state.totp.add(s.userId);
    expect(await policy.enrolmentRequirement(s)).toBe("passkey");
  });

  it("sees a new factor once its cache is forgotten", async () => {
    const s = session("administrator");
    await policy.saveMfaPolicy(s.siteId, { requiredRoles: ["administrator"] });
    expect(await policy.enrolmentRequirement(s)).toBe("mfa");
    state.totp.add(s.userId);
    policy.forgetSecondFactors(s.userId);
    expect(await policy.enrolmentRequirement(s)).toBeNull();
  });

  it("lets an account that must enrol reach only enrolment, password, session, and sign-out APIs", () => {
    for (const url of ["/api/auth/me", "/api/auth/2fa/setup", "/api/auth/passkeys/register/options?x=1", "/api/auth/logout", "/api/auth/password", "/api/auth/sessions/abc"]) {
      expect(policy.allowedDuringEnrolment(url)).toBe(true);
    }
    for (const url of ["/api/content", "/api/users", "/api/auth/mexico", "/api/auth/2fa-bypass", "/api/settings?next=/api/auth/me"]) {
      expect(policy.allowedDuringEnrolment(url)).toBe(false);
    }
  });
});
