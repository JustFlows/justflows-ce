// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { extractImageMetadata, generateDerivatives } from "../../../src/derivatives/image-processor.js";

async function solidPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 20, g: 80, b: 160, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

describe("generateDerivatives png format", () => {
  it("produces a square PNG at the requested size", async () => {
    const source = await solidPng(1024, 1024);
    const derivatives = await generateDerivatives(source, [
      { name: "icon-512", width: 512, height: 512, format: "png", quality: 100 },
    ]);
    const derivative = derivatives[0]!;
    expect(derivative.mimeType).toBe("image/png");
    expect(derivative.width).toBe(512);
    expect(derivative.height).toBe(512);

    const meta = await extractImageMetadata(derivative.data);
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
  });

  it("does not upscale a source smaller than the requested size", async () => {
    const source = await solidPng(300, 300);
    const derivatives = await generateDerivatives(source, [
      { name: "icon-512", width: 512, height: 512, format: "png", quality: 100 },
    ]);
    expect(derivatives[0]!.width).toBeLessThanOrEqual(300);
  });
});
