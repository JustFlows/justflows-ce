import { describe, expect, it } from "vitest";
import {
  blockAnimationCss,
  compactBlockAnimation,
  DEFAULT_BLOCK_ANIMATION,
  parseBlockAnimation,
  withBlockAnimation,
} from "./animation.js";

describe("parseBlockAnimation", () => {
  it("returns defaults for missing or hostile input", () => {
    expect(parseBlockAnimation(undefined)).toEqual(DEFAULT_BLOCK_ANIMATION);
    expect(parseBlockAnimation({ entrance: "<script>", duration: 99, hover: "explode" })).toEqual({
      ...DEFAULT_BLOCK_ANIMATION,
      duration: 2.5,
    });
  });

  it("accepts a known preset", () => {
    expect(
      parseBlockAnimation({
        entrance: "fade-up",
        trigger: "load",
        duration: 0.4,
        delay: 0.2,
        easing: "spring",
        once: false,
        hover: "lift",
        tap: "press",
      }),
    ).toEqual({
      entrance: "fade-up",
      trigger: "load",
      duration: 0.4,
      delay: 0.2,
      easing: "spring",
      once: false,
      hover: "lift",
      tap: "press",
    });
  });
});

describe("compactBlockAnimation", () => {
  it("omits inactive configs", () => {
    expect(compactBlockAnimation(DEFAULT_BLOCK_ANIMATION)).toBeUndefined();
  });

  it("stores only overrides", () => {
    expect(compactBlockAnimation({ ...DEFAULT_BLOCK_ANIMATION, entrance: "zoom-in", hover: "grow" })).toEqual({
      entrance: "zoom-in",
      hover: "grow",
    });
  });
});

describe("withBlockAnimation", () => {
  it("leaves markup unchanged when animation is off", () => {
    const html = '<section class="jf-hero">Hi</section>';
    expect(withBlockAnimation(html, {})).toBe(html);
  });

  it("merges class and style on the root tag", () => {
    const html = '<section class="jf-hero" style="background:#fff">Hi</section>';
    const out = withBlockAnimation(html, { animation: { entrance: "fade-up", duration: 0.8 } });
    expect(out).toContain('class="jf-hero jf-anim jf-anim-e-fade-up jf-anim--wait jf-anim-ease-ease-out"');
    expect(out).toContain("background:#fff;--jf-anim-duration:0.8s;--jf-anim-delay:0s");
    expect(out).toContain('data-jf-anim="in-view"');
    expect(out).toContain('data-jf-anim-once="1"');
    expect(out).toContain(">Hi</section>");
  });

  it("plays immediately for on-load entrance", () => {
    const out = withBlockAnimation("<p>Hi</p>", { animation: { entrance: "fade", trigger: "load" } });
    expect(out).toContain("jf-anim--play");
    expect(out).toContain('data-jf-anim="load"');
    expect(out).not.toContain("data-jf-anim-once");
  });
});

describe("blockAnimationCss", () => {
  it("ships keyframes and a reduced-motion escape", () => {
    const css = blockAnimationCss();
    expect(css).toContain("@keyframes jf-anim-fade-up");
    expect(css).toContain("prefers-reduced-motion");
  });
});
