// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { defaultSignupEmailPolicy, SignupEmailPolicySchema, signupEmailAllowed } from "../../../src/lib/security/signup-email-policy.js";
import { buildSaasSettings, readSaasSettings, withPurgeAfterDays } from "../../../src/lib/tenancy/saas-settings.js";

describe("signup email policy", () => {
  it("preserves existing signup behavior by default", () => {
    expect(signupEmailAllowed("person@mailinator.com", defaultSignupEmailPolicy())).toBe(true);
  });
  it("blocks disposable domains and subdomains, with explicit allow exceptions", () => {
    const policy = { ...defaultSignupEmailPolicy(), blockDisposable: true, allow: ["trusted@mailinator.com"] };
    expect(signupEmailAllowed("user@mailinator.com", policy)).toBe(false);
    expect(signupEmailAllowed("user@sub.mailinator.com", policy)).toBe(false);
    expect(signupEmailAllowed(" TRUSTED@MAILINATOR.COM ", policy)).toBe(true);
    expect(signupEmailAllowed("user@gmail.com", policy)).toBe(true);
  });
  it("gives explicit blocks priority and respects domain boundaries", () => {
    const policy = { ...defaultSignupEmailPolicy(), allow: ["example.com"], block: ["blocked@example.com", "bad.example.com"] };
    expect(signupEmailAllowed("blocked@example.com", policy)).toBe(false);
    expect(signupEmailAllowed("user@bad.example.com", policy)).toBe(false);
    expect(signupEmailAllowed("user@good.example.com", policy)).toBe(true);
    policy.allowListedOnly = true;
    expect(signupEmailAllowed("user@fakeexample.com", policy)).toBe(false);
    expect(signupEmailAllowed("user@example.com.attacker.com", policy)).toBe(false);
  });
  it("normalizes and deduplicates entries and rejects invalid configuration", () => {
    expect(SignupEmailPolicySchema.parse({ ...defaultSignupEmailPolicy(), allow: [" Example.COM ", "example.com"] }).allow).toEqual(["example.com"]);
    for (const entry of ["*.example.com", "@example.com", "https://example.com", "example.com/path", "invalid", "bad@@example.com"]) {
      expect(SignupEmailPolicySchema.safeParse({ ...defaultSignupEmailPolicy(), block: [entry] }).success).toBe(false);
    }
    expect(SignupEmailPolicySchema.safeParse({ ...defaultSignupEmailPolicy(), allowListedOnly: true }).success).toBe(false);
    expect(SignupEmailPolicySchema.safeParse({ ...defaultSignupEmailPolicy(), block: Array(1001).fill("example.com") }).success).toBe(false);
    expect(signupEmailAllowed("invalid", defaultSignupEmailPolicy())).toBe(false);
  });
  it("round trips settings and keeps the policy when unrelated settings change", () => {
    const policy = { ...defaultSignupEmailPolicy(), blockDisposable: true, block: ["bad.example"] };
    const previous = { signupEnabled: true, baseDomain: "example.com", signupEmailPolicy: policy };
    expect(readSaasSettings(JSON.stringify(JSON.stringify(previous)))?.signupEmailPolicy).toEqual(policy);
    expect(withPurgeAfterDays(previous, 12).signupEmailPolicy).toEqual(policy);
    const result = buildSaasSettings(previous, { signupEnabled: true, baseDomain: "other.example", signupDatabaseMode: "current" });
    expect(result.ok && result.stored.signupEmailPolicy).toEqual(policy);
  });
});
