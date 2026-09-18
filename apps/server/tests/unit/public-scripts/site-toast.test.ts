// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const script = fs.readFileSync(
  path.resolve(fileURLToPath(import.meta.url), "../../../../../../public/js/site-toast.js"),
  "utf8",
);

function setupDom(markup: string, reducedMotion = false): void {
  document.body.innerHTML = markup;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduced-motion") && reducedMotion,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof window.requestAnimationFrame;
}

function runScript(): void {
  new Function(script).call(window);
}

function load(markup: string, reducedMotion = false): void {
  setupDom(markup, reducedMotion);
  runScript();
}

function toast(): HTMLElement {
  return document.querySelector("[data-jf-toast]") as HTMLElement;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("site-toast", () => {
  it("colors an error toast red with a warning icon", () => {
    load('<p data-jf-toast="error">Something went wrong</p>');
    const el = toast();
    expect(el.style.background.replace(/\s+/g, "")).toBe("rgb(220,38,38)");
    expect(el.style.color.replace(/\s+/g, "")).toBe("rgb(255,255,255)");
    expect(el.textContent).toContain("Something went wrong");
    expect(el.querySelector("span[aria-hidden]")?.textContent).toContain("⚠");
  });

  it("colors a success toast green with a check icon", () => {
    load('<p data-jf-toast="success">Posted</p>');
    const el = toast();
    expect(el.style.background.replace(/\s+/g, "")).toBe("rgb(22,163,74)");
    expect(el.querySelector("span[aria-hidden]")?.textContent).toContain("✓");
  });

  it("positions the toast as a floating, high z-index overlay", () => {
    load('<p data-jf-toast="error">Oops</p>');
    const el = toast();
    expect(el.style.position).toBe("fixed");
    expect(Number(el.style.zIndex)).toBeGreaterThan(100_000);
  });

  it("skips the entrance transition under prefers-reduced-motion", () => {
    load('<p data-jf-toast="error">Oops</p>', true);
    const el = toast();
    expect(el.style.transition).toBe("");
  });

  it("adds a dismiss button that removes the toast on click", () => {
    load('<p data-jf-toast="error">Oops</p>');
    document.querySelector("button")!.click();
    vi.advanceTimersByTime(1000);
    expect(toast()).toBeNull();
  });

  it("auto-dismisses after the timeout", () => {
    load('<p data-jf-toast="error">Oops</p>');
    expect(toast()).not.toBeNull();
    vi.advanceTimersByTime(7000);
    vi.advanceTimersByTime(1000);
    expect(toast()).toBeNull();
  });

  it("does not re-toastify (double icon, duplicate listeners) on a second pass", () => {
    setupDom('<p data-jf-toast="error">Oops</p>');
    runScript();
    runScript();
    expect(toast().querySelectorAll("span[aria-hidden]")).toHaveLength(1);
    expect(toast().querySelectorAll("button")).toHaveLength(1);
  });

  it("falls back to a neutral tone for an unrecognized data-jf-toast value", () => {
    load('<p data-jf-toast="mystery">Huh</p>');
    const el = toast();
    expect(el.style.background.replace(/\s+/g, "")).toBe("rgb(31,41,55)");
  });
});
