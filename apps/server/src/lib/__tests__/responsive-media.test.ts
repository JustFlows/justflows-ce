// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from "vitest";
import {
  applyResponsiveProp,
  buildResponsiveProp,
  isUploadUrl,
  parseDerivatives,
  responsiveMarkupEnabled,
} from "../responsive-media.js";

const ORIGINAL = process.env.JF_IMAGE_RESPONSIVE_MARKUP;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.JF_IMAGE_RESPONSIVE_MARKUP;
  else process.env.JF_IMAGE_RESPONSIVE_MARKUP = ORIGINAL;
});

describe("responsiveMarkupEnabled", () => {
  it("defaults on and honours the kill switch", () => {
    delete process.env.JF_IMAGE_RESPONSIVE_MARKUP;
    expect(responsiveMarkupEnabled()).toBe(true);
    process.env.JF_IMAGE_RESPONSIVE_MARKUP = "0";
    expect(responsiveMarkupEnabled()).toBe(false);
    process.env.JF_IMAGE_RESPONSIVE_MARKUP = "1";
    expect(responsiveMarkupEnabled()).toBe(true);
  });
});

describe("isUploadUrl", () => {
  it("accepts only /uploads/ paths", () => {
    expect(isUploadUrl("/uploads/a.jpg")).toBe(true);
    expect(isUploadUrl("https://cdn.example/a.jpg")).toBe(false);
    expect(isUploadUrl("/themes/x.png")).toBe(false);
    expect(isUploadUrl(42)).toBe(false);
  });
});

describe("parseDerivatives", () => {
  it("parses JSON strings and objects, rejecting anything without a variants array", () => {
    expect(parseDerivatives("{}")).toBeNull();
    expect(parseDerivatives("not json")).toBeNull();
    expect(parseDerivatives({ variants: [] })).toEqual({ variants: [] });
    const obj = {
      variants: [{ w: 320, h: 200, format: "webp", url: "/uploads/x/320.webp", bytes: 1 }],
    };
    expect(parseDerivatives(JSON.stringify(obj))).toEqual(obj);
  });
});

describe("buildResponsiveProp", () => {
  const row = {
    url: "/uploads/x.jpg",
    width: 1600,
    height: 900,
    focal_x: 0.25,
    focal_y: 0.75,
    derivatives: JSON.stringify({
      base: { w: 1600, h: 900, format: "jpeg" },
      variants: [
        { w: 640, h: 360, format: "jpeg", url: "/uploads/x/640.jpg", bytes: 10 },
        { w: 1280, h: 720, format: "jpeg", url: "/uploads/x/1280.jpg", bytes: 20 },
        { w: 640, h: 360, format: "webp", url: "/uploads/x/640.webp", bytes: 8 },
        { w: 1280, h: 720, format: "webp", url: "/uploads/x/1280.webp", bytes: 16 },
        { w: 640, h: 360, format: "avif", url: "/uploads/x/640.avif", bytes: 6 },
      ],
    }),
  };

  it("orders modern sources avif→webp, sorts srcset ascending, and keeps the focal point", () => {
    const prop = buildResponsiveProp(row)!;
    expect(prop.sources.map((s) => s.type)).toEqual(["image/avif", "image/webp"]);
    expect(prop.sources[1]!.srcset).toBe("/uploads/x/640.webp 640w, /uploads/x/1280.webp 1280w");
    expect(prop.fallbackSrcset).toBe("/uploads/x/640.jpg 640w, /uploads/x/1280.jpg 1280w");
    expect(prop.src).toBe("/uploads/x/1280.jpg"); // largest fallback
    expect(prop).toMatchObject({ width: 1600, height: 900, focalX: 0.25, focalY: 0.75 });
  });

  it("returns null when there are no variants", () => {
    expect(buildResponsiveProp({ ...row, derivatives: "{}" })).toBeNull();
  });
});

describe("applyResponsiveProp", () => {
  it("layers derivative data onto the base input, leaving base alone without a prop", () => {
    const base = { src: "/uploads/x.jpg", alt: "x", sizes: "100vw" as const };
    expect(applyResponsiveProp(base, undefined)).toBe(base);

    const merged = applyResponsiveProp(base, {
      src: "/uploads/x/1280.jpg",
      width: 1600,
      height: 900,
      sources: [{ type: "image/webp", srcset: "/uploads/x/640.webp 640w" }],
      fallbackSrcset: "/uploads/x/640.jpg 640w",
      focalX: 0.1,
      focalY: null,
    });
    expect(merged).toMatchObject({
      src: "/uploads/x/1280.jpg",
      width: 1600,
      height: 900,
      focalX: 0.1,
    });
    expect("focalY" in merged).toBe(false);
  });
});
