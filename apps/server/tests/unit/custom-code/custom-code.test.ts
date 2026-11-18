// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => new Map<string, unknown>());
const feature = vi.hoisted(() => ({ enabled: true }));
vi.mock("../../../src/lib/tenancy/site-features.js", () => ({ siteFeatureEnabled: async () => feature.enabled }));
vi.mock("../../../src/lib/settings/site-settings.js", () => ({
  getSiteSetting: async (siteId: string, key: string) => settings.get(`${siteId}:${key}`) ?? null,
  setSiteSetting: async (siteId: string, key: string, value: unknown) => {
    settings.set(`${siteId}:${key}`, JSON.parse(JSON.stringify(value)));
  },
}));

const {
  customCodeCsp,
  describeChanges,
  invalidateCustomCodeCache,
  renderCustomCode,
  saveCustomCode,
  validateCustomCode,
  withCustomCodeHashes,
} = await import("../../../src/lib/custom-code/custom-code.js");

const page = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

const base = {
  enabled: true,
  scope: { type: "site" as const },
  consent: "necessary" as const,
  environments: [] as string[],
};

async function save(raw: unknown) {
  const result = await validateCustomCode(raw);
  if (!result.config) throw new Error(result.errors.join("; "));
  await saveCustomCode("site-1", result.config, { userId: "admin-1" });
  return result;
}

const hash = (body: string) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;

beforeEach(() => {
  feature.enabled = true;
  settings.clear();
  invalidateCustomCodeCache();
  delete process.env.JF_CUSTOM_CODE;
  delete process.env.JF_ENVIRONMENT;
});
afterEach(() => {
  delete process.env.JF_CUSTOM_CODE;
  delete process.env.JF_ENVIRONMENT;
});

describe("custom code validation", () => {
  it("refuses script tags, a closing </script>, http URLs, and origins that are not allowlisted", async () => {
    const result = await validateCustomCode({
      allowedOrigins: ["https://cdn.example.com", "http://insecure.example.com"],
      snippets: [
        { ...base, name: "Tags", placement: "head", kind: "inline", code: "<script>alert(1)</script>" },
        { ...base, name: "Http", placement: "head", kind: "external", src: "http://cdn.example.com/a.js" },
        { ...base, name: "Other", placement: "head", kind: "external", src: "https://evil.example.net/a.js" },
      ],
    });
    expect(result.config).toBeNull();
    expect(result.errors.join("\n")).toMatch(/without <script> tags/);
    expect(result.errors.join("\n")).toMatch(/must not contain <\/script>/);
    expect(result.errors.join("\n")).toMatch(/must start with https/);
    expect(result.errors.join("\n")).toMatch(/evil\.example\.net is not in the allowed origins/);
    expect(result.errors.join("\n")).toMatch(/"http:\/\/insecure\.example\.com" is not an https origin/);
  });

  it("sanitizes markup and refuses consent on non-script markup", async () => {
    const result = await validateCustomCode({
      allowedOrigins: ["https://px.example.com"],
      snippets: [{ ...base, name: "Pixel", placement: "bodyStart", kind: "markup", code: '<img src="https://px.example.com/p.gif" onerror="alert(1)"><script>bad()</script>' }],
    });
    expect(result.config?.snippets[0]?.code).toBe('<img src="https://px.example.com/p.gif" />');
    expect(result.warnings.join("\n")).toMatch(/unsafe tags or attributes were removed/);
    const gated = await validateCustomCode({ snippets: [{ ...base, name: "Meta", placement: "head", kind: "markup", code: '<meta name="x" content="y">', consent: "analytics" }] });
    expect(gated.errors.join("\n")).toMatch(/only scripts can wait for consent/);
  });

  it("checks library parameters and warns about tracking without consent", async () => {
    const bad = await validateCustomCode({ snippets: [{ ...base, name: "GA", placement: "head", kind: "library", library: { id: "google-analytics", values: { measurementId: "UA-1');alert(1)//" } } }] });
    expect(bad.errors.join("\n")).toMatch(/Measurement ID must look like G-/);
    const ok = await validateCustomCode({ snippets: [{ ...base, name: "GA", placement: "head", kind: "library", library: { id: "google-analytics", values: { measurementId: "G-ABC123" } } }] });
    expect(ok.warnings.join("\n")).toMatch(/usually needs analytics consent/);
    const inline = await validateCustomCode({ snippets: [{ ...base, name: "Raw", placement: "head", kind: "inline", code: "gtag('config','G-1')" }] });
    expect(inline.warnings.join("\n")).toMatch(/looks like tracking code but runs without consent/);
  });
});

describe("custom code on pages", () => {
  it("renders each placement, per page, gated by consent, and never on previews", async () => {
    await save({
      allowedOrigins: ["https://cdn.example.com"],
      snippets: [
        { ...base, id: "head", name: "Head", placement: "head", kind: "inline", code: "window.a=1;" },
        { ...base, id: "start", name: "Start", placement: "bodyStart", kind: "markup", code: '<meta name="verify" content="abc">' },
        { ...base, id: "end", name: "End", placement: "bodyEnd", kind: "external", src: "https://cdn.example.com/w.js", consent: "marketing" },
        { ...base, id: "one", name: "One page", placement: "head", kind: "inline", code: "window.b=2;", scope: { type: "pages", contentIds: [page] } },
      ],
    });
    const home = await renderCustomCode("site-1", { contentId: page });
    expect(home.head).toBe('<script data-jf-custom-code="head">window.a=1;</script><script data-jf-custom-code="one">window.b=2;</script>');
    expect(home.bodyStart).toContain('<meta name="verify" content="abc" />');
    expect(home.bodyEnd).toBe('<script type="text/plain" data-jf-consent="marketing" data-jf-src="https://cdn.example.com/w.js" async data-jf-custom-code="end"></script>');
    expect((await renderCustomCode("site-1", { contentId: other })).head).not.toContain("window.b");
    expect(await renderCustomCode("site-1", { contentId: page, preview: true })).toEqual({ head: "", bodyStart: "", bodyEnd: "" });
    expect(await renderCustomCode("site-1", { contentId: page, privateAccount: true })).toEqual({ head: "", bodyStart: "", bodyEnd: "" });
  });

  it("renders a library snippet from its template and lets its origins through the CSP", async () => {
    await save({ snippets: [{ ...base, id: "ga", name: "GA", placement: "head", kind: "library", consent: "analytics", library: { id: "google-analytics", values: { measurementId: "G-ABC123" } } }] });
    const rendered = await renderCustomCode("site-1", {});
    expect(rendered.head).toContain('data-jf-src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"');
    expect(rendered.head).toContain(`gtag('config',"G-ABC123")`);
    const csp = await customCodeCsp("site-1");
    expect(csp?.script).toContain("https://www.googletagmanager.com");
    expect(csp?.connect).toContain("https://*.google-analytics.com");
  });

  it("renders nothing when the platform operator turns custom code off for the website", async () => {
    await save({ snippets: [{ ...base, id: "a", name: "A", placement: "head", kind: "inline", code: "window.a=1;" }] });
    feature.enabled = false;
    invalidateCustomCodeCache();
    expect((await renderCustomCode("site-1", {})).head).toBe("");
    expect(await customCodeCsp("site-1")).toBeNull();
  });

  it("safe mode and JF_CUSTOM_CODE=off turn everything off; environments limit a snippet", async () => {
    await save({ snippets: [{ ...base, id: "a", name: "A", placement: "head", kind: "inline", code: "window.a=1;", environments: ["production"] }] });
    process.env.JF_ENVIRONMENT = "staging";
    invalidateCustomCodeCache();
    expect((await renderCustomCode("site-1", {})).head).toBe("");
    process.env.JF_ENVIRONMENT = "production";
    expect((await renderCustomCode("site-1", {})).head).toContain("window.a");
    process.env.JF_CUSTOM_CODE = "off";
    expect((await renderCustomCode("site-1", {})).head).toBe("");
    expect(await customCodeCsp("site-1")).toBeNull();
    delete process.env.JF_CUSTOM_CODE;
    await save({ safeMode: true, snippets: [{ ...base, id: "a", name: "A", placement: "head", kind: "inline", code: "window.a=1;" }] });
    expect((await renderCustomCode("site-1", {})).head).toBe("");
  });
});

describe("Content Security Policy", () => {
  it("allows exactly the live inline scripts by hash and the allowlisted origins", async () => {
    await save({
      allowedOrigins: ["https://cdn.example.com"],
      snippets: [
        { ...base, id: "a", name: "A", placement: "head", kind: "inline", code: "window.a=1;" },
        { ...base, id: "w", name: "W", placement: "bodyEnd", kind: "external", src: "https://cdn.example.com/w.js" },
        { ...base, id: "off", name: "Off", placement: "head", kind: "inline", code: "window.off=1;", enabled: false },
      ],
    });
    const csp = await customCodeCsp("site-1");
    expect(csp?.hashes).toEqual([hash("window.a=1;")]);
    expect(csp?.script).toEqual(["https://cdn.example.com"]);
    const policy = withCustomCodeHashes("default-src 'self'; script-src 'self'", csp!.hashes);
    expect(policy).toBe(`default-src 'self'; script-src 'self' ${hash("window.a=1;")}`);
    expect(policy).not.toContain("unsafe-inline");
  });

  it("never turns off an existing 'unsafe-inline' and never opens a 'none' policy", () => {
    const hashes = [hash("x")];
    expect(withCustomCodeHashes("script-src 'self' 'unsafe-inline'", hashes)).toBe("script-src 'self' 'unsafe-inline'");
    expect(withCustomCodeHashes("script-src 'none'", hashes)).toBe("script-src 'none'");
    expect(withCustomCodeHashes("default-src 'self'", hashes)).toBe(`default-src 'self'; script-src 'self' ${hashes[0]}`);
  });
});

describe("change history", () => {
  it("keeps versions and describes changes for the audit log", async () => {
    await save({ snippets: [{ ...base, id: "a", name: "A", placement: "head", kind: "inline", code: "one();" }] });
    await save({ allowedOrigins: ["https://cdn.example.com"], snippets: [{ ...base, id: "a", name: "A", placement: "head", kind: "inline", code: "two();" }] });
    const history = settings.get("site-1:custom_code_history") as Array<{ version: number; savedBy: string }>;
    expect(history.map((entry) => entry.version)).toEqual([2, 1]);
    expect(history[0]?.savedBy).toBe("admin-1");
    const before = { safeMode: false, allowedOrigins: [], snippets: [{ ...base, id: "a", name: "A", placement: "head" as const, kind: "inline" as const, code: "one();" }] };
    const after = { ...before, allowedOrigins: ["https://cdn.example.com"], snippets: [{ ...before.snippets[0]!, code: "two();" }] };
    const diff = describeChanges(before, after);
    expect(diff).toContain("+ origins https://cdn.example.com");
    expect(diff).toContain("-one(); +two();");
  });
});
