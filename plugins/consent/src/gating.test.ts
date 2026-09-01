import { describe, it, expect } from "vitest";
import { gateScriptMarkup, gateSnippet, gateEmbedsInHtml, encodeEmbed } from "./gating.js";

describe("gateScriptMarkup", () => {
  it("neutralises an external script until the category is granted", () => {
    const out = gateScriptMarkup(
      '<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXX"></script>',
      "analytics",
    );
    expect(out).toContain('type="text/plain"');
    expect(out).toContain('data-jf-consent="analytics"');
    expect(out).toContain('data-jf-src="https://www.googletagmanager.com/gtag/js?id=G-XXX"');
    expect(out).not.toMatch(/\ssrc=/);
  });

  it("neutralises an inline script and keeps its body", () => {
    const out = gateScriptMarkup("<script>gtag('config','G-XXX')</script>", "analytics");
    expect(out).toBe(
      "<script type=\"text/plain\" data-jf-consent=\"analytics\">gtag('config','G-XXX')</script>",
    );
  });

  it("does not double-mark on a second pass", () => {
    const once = gateScriptMarkup("<script>a()</script>", "analytics");
    const twice = gateScriptMarkup(once, "analytics");
    expect(twice).toBe(once);
  });
});

describe("gateSnippet", () => {
  it("wraps a bare inline snippet", () => {
    expect(gateSnippet("fbq('init','1')", "marketing")).toBe(
      "<script type=\"text/plain\" data-jf-consent=\"marketing\">fbq('init','1')</script>",
    );
  });
  it("returns empty for whitespace", () => {
    expect(gateSnippet("   \n ", "analytics")).toBe("");
  });
});

describe("gateEmbedsInHtml", () => {
  const labels = { title: "Blocked", unlock: "Load" };

  it("replaces an off-site iframe with an unlockable placeholder", () => {
    const html = '<p>x</p><iframe src="https://www.youtube.com/embed/abc" title="Clip"></iframe>';
    const { html: out, gated } = gateEmbedsInHtml(html, "example.com", labels);
    expect(gated).toBe(1);
    expect(out).toContain("jf-consent-embed");
    expect(out).toContain('data-jf-consent-category="marketing"');
    expect(out).toContain("Blocked: Clip");
    expect(out).not.toContain("<iframe");
    const encoded = out.match(/data-jf-consent-embed="([^"]+)"/)?.[1] ?? "";
    expect(Buffer.from(encoded, "base64").toString("utf8")).toContain("youtube.com/embed/abc");
  });

  it("leaves a same-host iframe alone", () => {
    const html = '<iframe src="https://example.com/local"></iframe>';
    const { html: out, gated } = gateEmbedsInHtml(html, "example.com", labels);
    expect(gated).toBe(0);
    expect(out).toBe(html);
  });

  it("round-trips arbitrary markup through encodeEmbed", () => {
    const original = '<iframe src="https://maps.example/x?a=1&b=2"></iframe>';
    expect(Buffer.from(encodeEmbed(original), "base64").toString("utf8")).toBe(original);
  });
});
