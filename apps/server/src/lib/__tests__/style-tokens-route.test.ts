// SPDX-License-Identifier: MIT

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sampleManifest = {
  id: "justflows.sample",
  name: "Sample",
  customize: {
    sample: {
      label: "Sample",
      controls: {
        "--brand-gradient": {
          label: "Rainbow gradient",
          type: "select",
          default: "linear-gradient(90deg, red, blue)",
          options: [
            { label: "Accent colours", value: "linear-gradient(90deg, red, blue)" },
            { label: "Sunset", value: "linear-gradient(90deg, #ff0080, #ff8c00)" },
          ],
        },
        "--brand-anim": {
          label: "Rainbow animation",
          type: "select",
          default: "slide",
          options: [
            { label: "Slide", value: "slide" },
            { label: "Off", value: "none" },
          ],
        },
        "--brand-tilt": {
          label: "Card tilt",
          type: "range",
          default: 1.2,
          min: 0,
          max: 5,
          step: 0.1,
          unit: "deg",
        },
      },
    },
  },
  blockControls: {
    "core.hero": ["--brand-gradient", "--brand-anim", "--brand-tilt"],
    "core.bogus": ["--does-not-exist"],
  },
};

vi.mock("../themes-db.js", () => ({
  getSiteId: async () => "site-1",
  ensureThemesTable: async () => {},
  syncBundledThemes: async () => {},
  getActiveTheme: async () => ({
    theme_id: "justflows.sample",
    name: "Sample",
    manifest: sampleManifest,
    css_variables: {},
  }),
  themeInstalledPath: () => null,
}));
vi.mock("../theme-customize.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../theme-customize.js")>();
  return { ...actual, getThemeMods: async () => ({ sample: { "--brand-tilt": 3 } }) };
});
vi.mock("../../middleware/auth.js", () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));

const { default: themesRoutes } = await import("../../routes/themes.js");

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/themes", themesRoutes);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("GET /api/themes/style-tokens", () => {
  it("lists the theme's custom properties with current values and presets", async () => {
    const res = await fetch(`${base}/api/themes/style-tokens`);
    const body = (await res.json()) as {
      theme: string;
      tokens: Array<{
        name: string;
        value: string;
        section: string;
        presets?: unknown[];
        min?: number;
        unit?: string;
      }>;
      blockControls: Record<string, string[]>;
    };
    expect(body.theme).toBe("Sample");
    const byName = Object.fromEntries(body.tokens.map((t) => [t.name, t]));

    // no duplicates — `colorsDark` re-declares every `--color-*` name
    const names = body.tokens.map((t) => t.name);
    expect(names.length).toBe(new Set(names).size);
    expect(names.filter((n) => n === "--color-primary")).toHaveLength(1);

    // built-in colour token still listed
    expect(byName["--color-primary"]).toBeTruthy();

    // theme-contributed range reflects the saved mod, not the default, and
    // carries its bounds so the inspector can render a slider
    expect(byName["--brand-tilt"].value).toBe("3deg");
    expect(byName["--brand-tilt"].min).toBe(0);
    expect(byName["--brand-tilt"].unit).toBe("deg");

    // select token carries its preset list so valid strings are visible
    expect(byName["--brand-gradient"].presets).toEqual([
      { label: "Accent colours", value: "linear-gradient(90deg, red, blue)" },
      { label: "Sunset", value: "linear-gradient(90deg, #ff0080, #ff8c00)" },
    ]);

    // platform per-block hooks appended
    expect(byName["--jf-block-accent"].section).toBe("Per block");

    // colour-scheme widget hooks appended, grouped in their own section
    expect(byName["--jf-color-scheme-hover-bg"].section).toBe("Light / dark toggle");
    expect(byName["--jf-color-scheme-hover-bg"].type).toBe("color");
    expect(byName["--jf-color-scheme-active-bg"]).toBeTruthy();

    // blockControls: unknown token names and unknown-but-present are dropped
    expect(body.blockControls["core.hero"]).toEqual([
      "--brand-gradient",
      "--brand-anim",
      "--brand-tilt",
    ]);
    expect(body.blockControls["core.bogus"]).toBeUndefined();
  });
});
