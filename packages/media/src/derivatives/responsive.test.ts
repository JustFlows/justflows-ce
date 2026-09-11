// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  clampFocal,
  effectiveWidths,
  generateResponsiveSet,
  isRasterImageMimeType,
} from "./responsive.js";

async function solidJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

async function solidPngWithAlpha(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.4 } },
  })
    .png()
    .toBuffer();
}

describe("effectiveWidths", () => {
  it("drops widths at or above the source and never upscales", () => {
    expect(effectiveWidths(1000, { widths: [320, 640, 1280, 1920], maxWidth: 2560 })).toEqual([
      320, 640, 1000,
    ]);
  });

  it("caps the top width at maxWidth", () => {
    expect(effectiveWidths(5000, { widths: [320, 1920], maxWidth: 2000 })).toEqual([
      320, 1920, 2000,
    ]);
  });
});

describe("clampFocal", () => {
  it("defaults to centre and clamps out-of-range values", () => {
    expect(clampFocal(undefined)).toEqual({ x: 0.5, y: 0.5 });
    expect(clampFocal({ x: -3, y: 9 })).toEqual({ x: 0, y: 1 });
    expect(clampFocal({ x: 0.25, y: 0.75 })).toEqual({ x: 0.25, y: 0.75 });
  });
});

describe("isRasterImageMimeType", () => {
  it("accepts raster photos and rejects vector, icon, and documents", () => {
    expect(isRasterImageMimeType("image/jpeg")).toBe(true);
    expect(isRasterImageMimeType("image/WEBP")).toBe(true);
    expect(isRasterImageMimeType("image/svg+xml")).toBe(false);
    expect(isRasterImageMimeType("image/x-icon")).toBe(false);
    expect(isRasterImageMimeType("application/pdf")).toBe(false);
  });
});

describe("generateResponsiveSet", () => {
  it("emits width-scaled webp + jpeg fallback plus a thumbnail, without upscaling", async () => {
    const input = await solidJpeg(1600, 900);
    const set = await generateResponsiveSet(input, {
      config: { widths: [320, 640, 1280, 4000], formats: ["webp"], maxWidth: 2560 },
    });

    expect(set.source).toMatchObject({ width: 1600, height: 900, hasAlpha: false });

    const scaled = set.variants.filter((v) => v.kind === "scaled");
    const widths = [...new Set(scaled.map((v) => v.width))].sort((a, b) => a - b);
    expect(widths).toEqual([320, 640, 1280, 1600]);
    expect(Math.max(...widths)).toBeLessThanOrEqual(1600); // no upscaling past source

    // Each width has both a jpeg fallback and a webp variant.
    for (const w of widths) {
      const formats = scaled
        .filter((v) => v.width === w)
        .map((v) => v.format)
        .sort();
      expect(formats).toEqual(["jpeg", "webp"]);
    }

    const thumb = set.variants.find((v) => v.kind === "thumb");
    expect(thumb).toBeDefined();
    expect(thumb).toMatchObject({ format: "webp", width: 400, height: 400 });
  });

  it("uses a png fallback when the source has an alpha channel", async () => {
    const input = await solidPngWithAlpha(800, 800);
    const set = await generateResponsiveSet(input, {
      config: { widths: [320, 640], formats: ["webp"] },
    });
    expect(set.source.hasAlpha).toBe(true);
    const fallbackFormats = new Set(
      set.variants.filter((v) => v.kind === "scaled").map((v) => v.format),
    );
    expect(fallbackFormats.has("png")).toBe(true);
    expect(fallbackFormats.has("jpeg")).toBe(false);
  });

  it("strips metadata by default — no EXIF in the output", async () => {
    const withExif = await sharp({
      create: { width: 500, height: 400, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .withExif({ IFD0: { Copyright: "ACME", Software: "test" } })
      .jpeg()
      .toBuffer();

    const set = await generateResponsiveSet(withExif, {
      config: { widths: [320], formats: ["webp"], thumbnail: null },
    });
    for (const variant of set.variants) {
      const meta = await sharp(variant.data).metadata();
      expect(meta.exif).toBeUndefined();
    }
  });

  it("throws on a buffer that is not a decodable image", async () => {
    await expect(generateResponsiveSet(Buffer.from("not an image"))).rejects.toThrow();
  });
});
