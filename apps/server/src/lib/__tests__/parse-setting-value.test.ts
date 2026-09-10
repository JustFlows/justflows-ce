import { describe, expect, it } from "vitest";
import { parseSettingValue } from "../site-settings.js";

describe("parseSettingValue", () => {
  it("returns null only when the row is absent", () => {
    expect(parseSettingValue(false, undefined)).toBeNull();
    expect(parseSettingValue(true, null)).toBeNull();
    expect(parseSettingValue(true, undefined)).toBeNull();
  });

  // MySQL/MariaDB store the JSON text verbatim in a LONGTEXT column.
  it("parses JSON text from a string column", () => {
    expect(parseSettingValue(true, "false")).toBe(false);
    expect(parseSettingValue(true, "true")).toBe(true);
    expect(parseSettingValue(true, "0")).toBe(0);
    expect(parseSettingValue(true, '""')).toBe("");
    expect(parseSettingValue(true, '{"a":1}')).toEqual({ a: 1 });
  });

  it("keeps a non-JSON string as-is", () => {
    expect(parseSettingValue(true, "plain")).toBe("plain");
  });

  // Postgres hands `jsonb` back already decoded — a stored `false` must survive
  // as `false`, not be mistaken for an unset row (the old `!value` guard bug that
  // left "Discourage search engines" stuck on).
  it("passes an already-decoded jsonb value straight through", () => {
    expect(parseSettingValue(true, false)).toBe(false);
    expect(parseSettingValue(true, true)).toBe(true);
    expect(parseSettingValue(true, 0)).toBe(0);
    expect(parseSettingValue(true, { a: 1 })).toEqual({ a: 1 });
    expect(parseSettingValue(true, [])).toEqual([]);
  });
});
