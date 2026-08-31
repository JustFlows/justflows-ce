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
      padTop: "5",
      width: "wide",
      textAlign: "center",
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

  it("keeps safe pixel maximums and clamps extreme values", () => {
    expect(parseBlockStyle({ maxWidth: "640", maxHeight: 12000 })).toMatchObject({
      maxWidth: 640,
      maxHeight: 10000,
    });
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
    expect(blockStyleDeclarations(parseBlockStyle({ width: "full" }))).not.toContain(
      "margin-left:auto",
    );
  });

  it("maps corners and shadows onto theme tokens", () => {
    expect(blockStyleDeclarations(parseBlockStyle({ radius: "lg", shadow: "md" }))).toBe(
      "border-radius:var(--radius-lg);box-shadow:var(--shadow-md)",
    );
  });

  it("emits responsive maximum dimensions", () => {
    expect(blockStyleDeclarations(parseBlockStyle({ maxWidth: 640, maxHeight: 480 }))).toBe(
      "max-width:min(100%,640px);margin-left:auto;margin-right:auto;max-height:480px;overflow:auto",
    );
  });

  it("emits nothing at all for an untouched block", () => {
    expect(blockStyleDeclarations(parseBlockStyle({}))).toBe("");
  });

  it("clears a background with transparent / none and dims with opacity", () => {
    expect(blockStyleDeclarations(parseBlockStyle({ background: "transparent" }))).toContain(
      "background:transparent",
    );
    expect(blockStyleDeclarations(parseBlockStyle({ background: "none" }))).toContain(
      "background:none",
    );
    expect(blockStyleDeclarations(parseBlockStyle({ opacity: 40 }))).toBe("opacity:0.4");
    expect(blockStyleDeclarations(parseBlockStyle({ opacity: "0" }))).toBe("opacity:0");
    // out of range clamps; unset / 100 emit nothing here (panel treats 100 as clear)
    expect(blockStyleDeclarations(parseBlockStyle({ opacity: 250 }))).toBe("opacity:1");
    expect(blockStyleDeclarations(parseBlockStyle({ opacity: "" }))).toBe("");
    expect(blockStyleDeclarations(parseBlockStyle({ opacity: "nope" }))).toBe("");
  });

  it("writes per-instance colours as both a property and a --jf-block-* hook", () => {
    expect(
      blockStyleDeclarations(
        parseBlockStyle({ background: "#ff0080", textColor: "white", accent: "rgb(0 176 255)" }),
      ),
    ).toBe(
      "background:#ff0080;--jf-block-bg:#ff0080;color:white;--jf-block-text:white;--jf-block-accent:rgb(0 176 255);accent-color:rgb(0 176 255)",
    );
  });

  it("drops a colour that could break out of the style attribute", () => {
    const style = parseBlockStyle({
      background: "#fff; } body { display:none }",
      textColor: "url(//evil)",
      accent: "expression(alert(1))",
    });
    expect(style.background).toBe("");
    expect(style.textColor).toBe("");
    expect(style.accent).toBe("");
    expect(blockStyleDeclarations(style)).toBe("");
  });

  it("writes theme-token overrides from `vars` onto the block root", () => {
    const style = parseBlockStyle({
      vars: {
        "--brand-gradient": "linear-gradient(90deg, #ff0080, #00b0ff)",
        "--brand-anim": "none",
        "--brand-tilt": "3deg",
      },
    });
    expect(style.vars).toEqual({
      "--brand-gradient": "linear-gradient(90deg, #ff0080, #00b0ff)",
      "--brand-anim": "none",
      "--brand-tilt": "3deg",
    });
    expect(blockStyleDeclarations(style)).toBe(
      "--brand-gradient:linear-gradient(90deg, #ff0080, #00b0ff);--brand-anim:none;--brand-tilt:3deg",
    );
  });

  it("rejects a var whose name or value could escape the style attribute", () => {
    const style = parseBlockStyle({
      vars: {
        "--ok": "12px",
        "not-a-prop": "red",
        "--evil": "red; } body { display:none }",
        "--url": "url(javascript:alert(1))",
      },
    });
    expect(style.vars).toEqual({ "--ok": "12px" });
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
    expect(
      withBlockChrome("<section>Hi</section>", { id: "a", props: { style: { padTop: "5" } } }),
    ).toBe('<section style="padding-top:var(--space-5)">Hi</section>');
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
    expect(withBlockChrome("<section>Hi</section>", { id: "a", props: { style: {} } })).toBe(
      "<section>Hi</section>",
    );
  });

  it("writes theme-token overrides onto the block root for the theme to pick up", () => {
    const out = withBlockChrome('<section class="jf-hero">Hi</section>', {
      id: "a",
      props: {
        style: {
          vars: { "--brand-gradient": "linear-gradient(90deg, red, blue)", "--brand-anim": "none" },
        },
      },
    });
    expect(out).toContain("--brand-gradient:linear-gradient(90deg, red, blue)");
    expect(out).toContain("--brand-anim:none");
    expect(out.startsWith('<section class="jf-hero" style="')).toBe(true);
  });
});
