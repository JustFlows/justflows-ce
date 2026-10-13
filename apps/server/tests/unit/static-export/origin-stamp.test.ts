// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { originStampScript, withOriginStampCsp } from "../../../src/lib/static-export/origin-stamp.js";

const hashOf = (script: string) => `'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`;

describe("origin stamp CSP", () => {
  it("hashes the exact script a subsite export stamps", () => {
    expect(originStampScript("")).toBe('window.__JF_ORIGIN__="";');
    expect(withOriginStampCsp("default-src 'self'; script-src 'self' https://www.googletagmanager.com", "")).toBe(
      "default-src 'self'; script-src 'self' https://www.googletagmanager.com 'sha256-fmijrwideWnrTd65Hpdm+l3mY4bZCFV9+BaqdzjzJRo='",
    );
  });

  it("escapes < so the origin cannot close the script", () => {
    expect(originStampScript("https://a.test/</script>")).not.toContain("</script>");
  });

  it("follows the configured origin", () => {
    const csp = withOriginStampCsp("script-src 'self'", "https://origin.test");
    expect(csp).toBe(`script-src 'self' ${hashOf('window.__JF_ORIGIN__="https://origin.test";')}`);
  });

  it("leaves unsafe-inline policies and unrestricted policies alone", () => {
    expect(withOriginStampCsp("script-src 'self' 'unsafe-inline'", "")).toBe("script-src 'self' 'unsafe-inline'");
    expect(withOriginStampCsp("img-src 'self'", "")).toBe("img-src 'self'");
  });

  it("derives script-src from default-src when missing", () => {
    expect(withOriginStampCsp("default-src 'self'", "")).toBe(
      `default-src 'self'; script-src 'self' ${hashOf('window.__JF_ORIGIN__="";')}`,
    );
  });

  it("does not add the hash twice", () => {
    const once = withOriginStampCsp("script-src 'self'", "");
    expect(withOriginStampCsp(once, "")).toBe(once);
  });
});
