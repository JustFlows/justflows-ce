import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDomainSettings,
  defaultDomainSettings,
  parseStoredDomainSettings,
  publicDomainSettings,
  type DomainSettingsInput,
} from "../../../src/lib/domains/domain-settings.js";

beforeEach(() => {
  process.env.APP_SECRET = "x".repeat(40);
});

function input(overrides: Partial<DomainSettingsInput> = {}): DomainSettingsInput {
  return {
    enabled: true,
    provider: "bunny",
    modes: { records: true, nameservers: true },
    cnameTarget: "Justflows.B-CDN.net.",
    apexAddresses: [],
    nameservers: ["ns1.justflows.com", "ns2.justflows.com"],
    soaEmail: "hostmaster@justflows.com",
    includeWww: true,
    redirectToPrimary: true,
    pendingExpiryDays: 7,
    failureThreshold: 3,
    upgradeUrl: "https://justflows.com/pricing",
    bunny: { pullZoneId: "12345", apiKey: "abcdef-123456" },
    ...overrides,
  };
}

describe("custom domain settings", () => {
  it("falls back to an off, manual default for a missing or broken value", () => {
    expect(parseStoredDomainSettings(undefined)).toEqual(defaultDomainSettings());
    expect(parseStoredDomainSettings("{not json")).toEqual(defaultDomainSettings());
    expect(
      parseStoredDomainSettings(JSON.stringify(JSON.stringify({ enabled: true }))).enabled,
    ).toBe(true);
  });

  it("normalizes the CNAME target and encrypts the API key", () => {
    const built = buildDomainSettings(defaultDomainSettings(), input());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.stored.cnameTarget).toBe("justflows.b-cdn.net");
    expect(built.stored.bunny.apiKeyCiphertext).toMatch(/^enc:v1:/);
    expect(publicDomainSettings(built.stored).bunny.apiKey).toEqual({ last4: "3456" });
    expect(JSON.stringify(publicDomainSettings(built.stored))).not.toContain("abcdef-123456");
  });

  it("keeps the stored key when the field is left empty, and clears it on null", () => {
    const first = buildDomainSettings(defaultDomainSettings(), input());
    if (!first.ok) throw new Error(first.error);
    const kept = buildDomainSettings(
      first.stored,
      input({ bunny: { pullZoneId: "12345", apiKey: "" } }),
    );
    expect(kept.ok && kept.stored.bunny.apiKeyCiphertext).toBe(first.stored.bunny.apiKeyCiphertext);
    const cleared = buildDomainSettings(
      first.stored,
      input({ bunny: { pullZoneId: "12345", apiKey: null } }),
    );
    expect(cleared.ok && cleared.stored.bunny.apiKeyCiphertext).toBe("");
  });

  it("refuses nameservers without Bunny, and Bunny without a pull zone", () => {
    expect(
      buildDomainSettings(defaultDomainSettings(), input({ provider: "manual" })),
    ).toMatchObject({ ok: false });
    expect(
      buildDomainSettings(
        defaultDomainSettings(),
        input({ bunny: { pullZoneId: "", apiKey: "abcdef-123456" } }),
      ),
    ).toMatchObject({ ok: false });
  });

  it("needs a CNAME target when records are offered", () => {
    expect(buildDomainSettings(defaultDomainSettings(), input({ cnameTarget: "" }))).toMatchObject({
      ok: false,
    });
  });

  it("validates addresses, nameservers, contact and upgrade link", () => {
    expect(
      buildDomainSettings(defaultDomainSettings(), input({ apexAddresses: ["300.1.1.1"] })),
    ).toMatchObject({ ok: false });
    expect(
      buildDomainSettings(defaultDomainSettings(), input({ nameservers: ["ns1.justflows.com"] })),
    ).toMatchObject({ ok: false });
    expect(buildDomainSettings(defaultDomainSettings(), input({ soaEmail: "nope" }))).toMatchObject(
      { ok: false },
    );
    expect(
      buildDomainSettings(defaultDomainSettings(), input({ upgradeUrl: "javascript:alert(1)" })),
    ).toMatchObject({ ok: false });
    const ok = buildDomainSettings(
      defaultDomainSettings(),
      input({ apexAddresses: ["203.0.113.10", " 2001:db8::1 "] }),
    );
    expect(ok.ok && ok.stored.apexAddresses).toEqual(["203.0.113.10", "2001:db8::1"]);
  });
});
