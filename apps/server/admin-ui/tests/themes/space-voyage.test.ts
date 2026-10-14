// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { BlockRegistry, coreBlocks } from "@justflows/blocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const theme = path.resolve(process.cwd(), process.cwd().endsWith("admin-ui") ? "../../../themes/space-voyage" : "../../themes/space-voyage");
const doc = JSON.parse(fs.readFileSync(path.join(theme, "demo/home.json"), "utf8"));
const script = fs.readFileSync(path.join(theme, "scripts/planet-jumping.js"), "utf8");
const registry = new BlockRegistry(); coreBlocks.forEach(block => registry.register(block));
let rejectPlayback = false;

beforeEach(() => {
  vi.useFakeTimers(); rejectPlayback = false;
  document.documentElement.className = ""; document.body.className = "";
  document.body.innerHTML = registry.renderDocument(doc);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
    save: vi.fn(), restore: vi.fn(), clip: vi.fn(),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    if (rejectPlayback) return Promise.reject(new Error("Playback rejected"));
    setTimeout(() => this.dispatchEvent(new Event("ended")), 1200);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(3);
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(1920);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(1080);
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1920);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(1080);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
const portal = () => document.querySelector<HTMLButtonElement>("#portal")!;
const tick = () => vi.advanceTimersByTimeAsync(5000);

describe("Space Voyage theme experience", () => {
  it("uses editable block content and performs both transitions, ending at Venus", async () => {
    window.eval(script); await tick();
    expect(document.body).toHaveClass("preload-complete", "intro-ready");
    expect(document.querySelector("#planet-title")).toHaveTextContent("MARS");
    expect(document.querySelectorAll(".fact")).toHaveLength(4);
    expect(portal()).toHaveAttribute("aria-label", "Travel to Earth");
    portal().click(); portal().click(); await tick();
    expect(document.querySelector(".experience")).toHaveAttribute("data-planet", "earth");
    expect(document.querySelector("#planet-title")).toHaveTextContent("EARTH");
    expect(portal()).toHaveAttribute("aria-label", "Travel to Venus");
    portal().click(); await tick();
    expect(document.querySelector(".experience")).toHaveAttribute("data-planet", "venus");
    expect(document.querySelector<HTMLImageElement>("#portal-image")!.hidden).toBe(false);
    expect(portal()).toHaveAttribute("aria-disabled", "true");
    portal().click(); await tick();
    expect(document.querySelector("#planet-title")).toHaveTextContent("VENUS");
    expect(document.querySelectorAll('.planet-item.active')).toHaveLength(1);
    expect(document.querySelectorAll('video[autoplay], video[controls]')).toHaveLength(0);
  });
  it("finishes the intro and recovers the controls when video playback fails", async () => {
    rejectPlayback = true; window.eval(script); await tick();
    expect(document.body).toHaveClass("intro-ready");
    portal().click(); await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector(".experience")).not.toHaveClass("is-transitioning");
    expect(document.querySelector("#planet-title")).toHaveTextContent("MARS");
    rejectPlayback = false; portal().click(); await tick();
    expect(document.querySelector("#planet-title")).toHaveTextContent("EARTH");
  });
  it("supports menu keyboard dismissal and leaves ordinary pages untouched", async () => {
    window.eval(script); await tick();
    document.querySelector<HTMLButtonElement>(".menu")!.click();
    expect(document.querySelector(".menu")).toHaveAttribute("aria-expanded", "true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".menu")).toHaveAttribute("aria-expanded", "false");
    document.body.innerHTML = '<p>Ordinary page</p>'; document.documentElement.className = '';
    window.eval(script);
    expect(document.querySelector(".experience")).toBeNull();
    expect(document.documentElement).not.toHaveClass("sv-cinematic");
  });
});
