// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, isCountryCode, listCountries } from "../../../src/lib/i18n/countries.js";
import { listTimeZones } from "../../../src/lib/i18n/datetime-format.js";
import {
  checkSettingValue,
  resolveSettingsSchema,
} from "../../../src/lib/plugins/plugin-settings-options.js";

const schema = {
  timeZone: {
    type: "select",
    label: "Store time zone",
    options: [{ value: "", label: "Same as the site" }],
    optionsSource: "timezones" as const,
  },
  country: { type: "select", label: "Country", optionsSource: "countries" as const },
  size: { type: "select", label: "Size", options: [{ value: "s", label: "Small" }] },
  note: { type: "string", label: "Note" },
};

describe("plugin setting choices", () => {
  it("fills select fields from the same lists core settings use", () => {
    const resolved = resolveSettingsSchema(schema, "en");
    const zones = resolved["timeZone"]?.options ?? [];
    expect(zones[0]).toEqual({ value: "", label: "Same as the site" });
    expect(zones.slice(1).map((option) => option.value)).toEqual(listTimeZones());
    const countries = resolved["country"]?.options ?? [];
    expect(countries).toHaveLength(COUNTRY_CODES.length);
    expect(countries).toContainEqual({ value: "NL", label: "Netherlands" });
    expect(resolved["note"]).toEqual(schema.note);
  });

  it("names countries in the site's language", () => {
    expect(listCountries("nl").find((item) => item.code === "DE")?.name).toBe("Duitsland");
    expect(isCountryCode("NL")).toBe(true);
    expect(isCountryCode("XX")).toBe(false);
  });

  it("only saves a listed choice, matching a different case to the listed value", () => {
    expect(checkSettingValue(schema.country, "NL")).toEqual({ ok: true, value: "NL" });
    expect(checkSettingValue(schema.country, "nl")).toEqual({ ok: true, value: "NL" });
    expect(checkSettingValue(schema.country, "Narnia")).toMatchObject({ ok: false });
    expect(checkSettingValue(schema.timeZone, "")).toEqual({ ok: true, value: "" });
    expect(checkSettingValue(schema.timeZone, "Europe/Amsterdam")).toEqual({ ok: true, value: "Europe/Amsterdam" });
    expect(checkSettingValue(schema.timeZone, "Mars/Olympus")).toMatchObject({ ok: false });
    expect(checkSettingValue(schema.note, "anything")).toEqual({ ok: true, value: "anything" });
  });
});
