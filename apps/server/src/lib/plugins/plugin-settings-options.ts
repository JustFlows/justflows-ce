// SPDX-License-Identifier: MIT

import { listCountries } from "../i18n/countries.js";
import { listTimeZones } from "../i18n/datetime-format.js";
import type { PluginDto } from "./plugins-db.js";

type Schema = NonNullable<PluginDto["settingsSchema"]>;
type Field = Schema[string];
export type SettingOption = { value: string; label: string };

/** Choices the host provides for `select` fields, from the same lists core settings use. */
export function sourceOptions(source: Field["optionsSource"], locale = "en"): SettingOption[] {
  if (source === "timezones") return listTimeZones().map((zone) => ({ value: zone, label: zone }));
  if (source === "countries") return listCountries(locale).map((item) => ({ value: item.code, label: item.name }));
  return [];
}

/** A field's choices: its own first, then the host's. Empty for non-select fields. */
export function fieldOptions(field: Field | undefined, locale = "en"): SettingOption[] {
  if (!field || field.type !== "select") return [];
  return [...(field.options ?? []), ...sourceOptions(field.optionsSource, locale)];
}

/** The schema as the admin form needs it, with every select field's choices filled in. */
export function resolveSettingsSchema(schema: Schema, locale = "en"): Schema {
  const out: Schema = {};
  for (const [key, field] of Object.entries(schema)) {
    out[key] = field.type === "select" ? { ...field, options: fieldOptions(field, locale) } : field;
  }
  return out;
}

/**
 * The value to store for a submitted setting. A select value must be one of
 * its choices; a different-case match (an older free-text `nl`) is stored as
 * the listed value (`NL`). Other field types pass through unchanged.
 */
export function checkSettingValue(
  field: Field | undefined,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!field || field.type !== "select") return { ok: true, value };
  const text = typeof value === "string" ? value.trim() : "";
  const options = fieldOptions(field);
  const match = options.find((option) => option.value === text)
    ?? options.find((option) => option.value.toLowerCase() === text.toLowerCase());
  if (match) return { ok: true, value: match.value };
  return { ok: false, error: `Choose one of the listed options for "${field.label}".` };
}
