// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  defaultModsFromSchema,
  mergeMods,
  modsToCssVariables,
  schemaWithThemeControls,
  THEME_CUSTOMIZE_SCHEMA,
} from "../../../src/lib/themes/theme-customize.js";

const sampleManifest = {
  customize: {
    sample: {
      label: "Sample",
      controls: {
        "--brand-accent": { label: "Accent — cyan", type: "color", default: "#00b0ff" },
        "--brand-tilt": {
          label: "Card tilt",
          type: "range",
          default: 1.2,
          min: 0,
          max: 5,
          step: 0.1,
          unit: "deg",
        },
        "--brand-border": {
          label: "Border style",
          type: "select",
          default: "dashed",
          options: [
            { label: "Dashed", value: "dashed" },
            { label: "Solid", value: "solid" },
          ],
        },
      },
    },
  },
};

describe("schemaWithThemeControls", () => {
  it("appends a theme's own section to the built-in schema", () => {
    const schema = schemaWithThemeControls(sampleManifest);
    expect(schema.sample?.label).toBe("Sample");
    expect(Object.keys(schema.sample!.controls)).toEqual([
      "--brand-accent",
      "--brand-tilt",
      "--brand-border",
    ]);
    // built-ins still present
    expect(schema.colors).toBeTruthy();
  });

  it("drops controls that are not --custom-properties or use an unsafe type", () => {
    const schema = schemaWithThemeControls({
      customize: {
        sample: {
          label: "Sample",
          controls: {
            "--ok": { label: "Fine", type: "color", default: "#fff" },
            plainKey: { label: "No prefix", type: "color", default: "#fff" },
            "--danger": { label: "Code", type: "code", default: "" },
          },
        },
      },
    });
    expect(Object.keys(schema.sample?.controls ?? {})).toEqual(["--ok"]);
  });

  it("ignores a section that tries to shadow a built-in one", () => {
    const schema = schemaWithThemeControls({
      customize: {
        colors: {
          label: "Hijack",
          controls: { "--x": { label: "x", type: "color", default: "#fff" } },
        },
      },
    });
    expect(schema.colors?.label).toBe("Colors");
  });

  it("returns just the built-in schema when the manifest has no customize block", () => {
    expect(schemaWithThemeControls({}).sample).toBeUndefined();
    expect(schemaWithThemeControls(null).colors).toBeTruthy();
  });
});

describe("defaultModsFromSchema package palette", () => {
  const haldenVars = {
    "--color-primary": "#161514",
    "--color-bg": "#faf9f6",
    "--font-sans": '"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif',
    "--heading-weight": "400",
    "--radius-sm": "0px",
    "--max-width": "760px",
    "--h1-size": "3.6rem",
  };

  it("starts from the package palette instead of the built-in blue defaults", () => {
    const mods = defaultModsFromSchema(THEME_CUSTOMIZE_SCHEMA, haldenVars);
    expect(mods.colors?.["--color-primary"]).toBe("#161514");
    expect(mods.colors?.["--color-bg"]).toBe("#faf9f6");
    expect(mods.typography?.["--font-sans"]).toBe(haldenVars["--font-sans"]);
    expect(mods.headings?.["--heading-weight"]).toBe("400");
    expect(mods.headings?.["--h1-size"]).toBe(3.6);
    expect(mods.radius?.["--radius-sm"]).toBe(0);
    expect(mods.layout?.contentWidth).toBe(760);
  });

  it("leaves the dark palette on the built-in defaults", () => {
    const mods = defaultModsFromSchema(THEME_CUSTOMIZE_SCHEMA, haldenVars);
    expect(mods.colorsDark?.["--color-bg"]).toBe("#0f172a");
    expect(mods.colorsDark?.["--color-primary"]).toBe("#60a5fa");
  });

  it("ignores a package colour that could break out of the declaration", () => {
    const mods = defaultModsFromSchema(THEME_CUSTOMIZE_SCHEMA, {
      "--color-primary": "red; } body { display:none",
    });
    expect(mods.colors?.["--color-primary"]).toBe("#3b82f6");
  });
});

describe("mods flow with theme controls", () => {
  it("seeds defaults for the theme section", () => {
    const schema = schemaWithThemeControls(sampleManifest);
    const defaults = defaultModsFromSchema(schema);
    expect(defaults.sample).toEqual({
      "--brand-accent": "#00b0ff",
      "--brand-tilt": 1.2,
      "--brand-border": "dashed",
    });
  });

  it("merges a theme section like a built-in one", () => {
    const schema = schemaWithThemeControls(sampleManifest);
    const merged = mergeMods(defaultModsFromSchema(schema), {
      sample: { "--brand-accent": "#ff0000" },
    });
    expect(merged.sample).toEqual({
      "--brand-accent": "#ff0000",
      "--brand-tilt": 1.2,
      "--brand-border": "dashed",
    });
  });

  it("emits theme-section values as :root tokens, validated by control type", () => {
    const schema = schemaWithThemeControls(sampleManifest);
    const mods = mergeMods(defaultModsFromSchema(schema), {
      sample: {
        "--brand-accent": "#123456",
        "--brand-tilt": 9, // above max → clamped to 5
        "--brand-border": "solid",
      },
    });
    const vars = modsToCssVariables({}, mods, schema);
    expect(vars["--brand-accent"]).toBe("#123456");
    expect(vars["--brand-tilt"]).toBe("5deg");
    expect(vars["--brand-border"]).toBe("solid");
  });

  it("stays silent on an unsafe colour / out-of-list select so the theme's own :root default stands", () => {
    const schema = schemaWithThemeControls(sampleManifest);
    const mods = mergeMods(defaultModsFromSchema(schema), {
      sample: { "--brand-accent": "red; } body { display:none", "--brand-border": "wiggly" },
    });
    const vars = modsToCssVariables({}, mods, schema);
    // rejected → not emitted by the Customizer at all; global.css `:root` wins
    expect(vars["--brand-accent"]).toBeUndefined();
    expect(vars["--brand-border"]).toBeUndefined();
  });
});
