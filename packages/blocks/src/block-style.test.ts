import { describe, expect, it } from "vitest";
import {
  blockStyleDeclarations,
  compactBlockStyle,
  isDefaultBlockStyle,
  parseBlockStyle,
  sanitizeBlockStyleProp,
} from "./block-style.js";
import { withBlockChrome } from "./block-chrome.js";

describe("parseBlockStyle", () => {
  it("treats an untouched block as having no style", () => {
    expect(isDefaultBlockStyle(parseBlockStyle(undefined))).toBe(true);
    expect(compactBlockStyle(parseBlockStyle({}))).toBeUndefined();
  });

  it("keeps values the controls can produce", () => {
    expect(parseBlockStyle({ padTop: "5", width: "wide", textAlign: "center" })).toMatchObject({
      padTop: "5", width: "wide", textAlign: "center",
    });
  });

  it("drops anything outside the allowed steps rather than passing it through", () => {
    // These reach a style attribute, so an allowlist is the whole defence.
    expect(parseBlockStyle({ padTop: "99" }).padTop).toBe("");
    expect(parseBlockStyle({ width: "red;background:url(//x)" }).width).toBe("");
    expect(parseBlockStyle({ textAlign: "center;position:fixed" }).textAlign).toBe("");
    expect(parseBlockStyle({ radius: "0}html{display:none" }).radius).toBe("");
  });

  it("clamps min height instead of trusting the number", () => {
    expect(parseBlockStyle({ minHeight: 400 }).minHeight).toBe(100);
    expect(parseBlockStyle({ minHeight: -20 }).minHeight).toBe(0);
    expect(parseBlockStyle({ minHeight: "60" }).minHeight).toBe(60);
  });
});

describe("blockStyleDeclarations", () => {
  it("writes spacing as scale steps, not raw lengths", () => {
    expect(blockStyleDeclarations(parseBlockStyle({ padTop: "5", marginBottom: "3" }))).toBe(
      "padding-top:var(--space-5);margin-bottom:var(--space-3)",
    );
  });

  it("treats step 0 as a real zero", () => {
    expect(blockStyleDeclarations(parseBlockStyle({ padTop: "0" }))).toBe("padding-top:0");
  });

  it("centres a constrained block, because a width alone says nothing about the slack", () => {
    const out = blockStyleDeclarations(parseBlockStyle({ width: "narrow" }));
    expect(out).toContain("max-width:34rem");
    expect(out).toContain("margin-left:auto");
  });

  it("does not centre a full-width block", () => {
    expect(blockStyleDeclarations(parseBlockStyle({ width: "full" }))).not.toContain("margin-left:auto");
  });

  it("maps corners and shadows onto theme tokens", () => {
    expect(blockStyleDeclarations(parseBlockStyle({ radius: "lg", shadow: "md" }))).toBe(
      "border-radius:var(--radius-lg);box-shadow:var(--shadow-md)",
    );
  });

  it("emits nothing at all for an untouched block", () => {
    expect(blockStyleDeclarations(parseBlockStyle({}))).toBe("");
  });
});

describe("sanitizeBlockStyleProp", () => {
  it("stores only what was set", () => {
    expect(sanitizeBlockStyleProp({ padTop: "4", padBottom: "" })).toEqual({ padTop: "4" });
    expect(sanitizeBlockStyleProp({})).toBeUndefined();
    expect(sanitizeBlockStyleProp(null)).toBeUndefined();
  });
});

describe("style on a rendered block", () => {
  it("lands on the block's own root element", () => {
    expect(withBlockChrome("<section>Hi</section>", { id: "a", props: { style: { padTop: "5" } } }))
      .toBe('<section style="padding-top:var(--space-5)">Hi</section>');
  });

  it("sits alongside grid placement without either losing out", () => {
    const out = withBlockChrome("<section>Hi</section>", {
      id: "a",
      props: { layout: { col: 3, span: 4 }, style: { padX: "4" } },
    });
    expect(out).toContain("--jf-col:3");
    expect(out).toContain("padding-left:var(--space-4)");
  });

  it("leaves an untouched block untouched", () => {
    expect(withBlockChrome("<section>Hi</section>", { id: "a", props: { style: {} } }))
      .toBe("<section>Hi</section>");
  });
});
