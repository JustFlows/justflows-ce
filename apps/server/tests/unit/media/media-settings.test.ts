// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { MediaSettingsBodySchema } from "../../../src/lib/media/media-settings.js";

const base = {
  enabled: true,
  responsiveMarkup: true,
  avif: true,
  widths: [320, 640],
  maxWidth: 2560,
  qualityWebp: 82,
  qualityAvif: 50,
  qualityJpeg: 82,
  stripMetadata: true,
  thumbnailSize: 400,
  keepOriginal: "",
};

describe("media settings AVIF effort", () => {
  it("defaults to 2 when a client sends the older settings shape", () => {
    expect(MediaSettingsBodySchema.parse(base).avifEffort).toBe(2);
  });

  it("accepts 1–9 and rejects values outside it", () => {
    expect(MediaSettingsBodySchema.parse({ ...base, avifEffort: "4" }).avifEffort).toBe(4);
    expect(MediaSettingsBodySchema.safeParse({ ...base, avifEffort: 0 }).success).toBe(false);
    expect(MediaSettingsBodySchema.safeParse({ ...base, avifEffort: 10 }).success).toBe(false);
  });
});
