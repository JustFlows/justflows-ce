// SPDX-License-Identifier: MIT
// @vitest-environment node
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { interpolate, lookupMessage } from "../../src/i18n/translate";
import { translateEnglish } from "../../src/i18n/translate-english";

/** Plural forms in the admin catalogs (justflows-ce#307). */

function catalog(locale: string): Record<string, string> {
  const file = fileURLToPath(new URL(`../../../src/lib/i18n/admin-catalogs/${locale}.json`, import.meta.url));
  const flat: Record<string, string> = {};
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string") flat[prefix + key] = value;
      else walk(value as Record<string, unknown>, `${prefix}${key}.`);
    }
  };
  walk(JSON.parse(fs.readFileSync(file, "utf8")), "");
  return flat;
}

const say = (locale: string, key: string, count: number) => interpolate(lookupMessage(catalog(locale), key, locale, { count })!, { count });

describe("plural forms", () => {
  it("pick the form the language needs", () => {
    expect(say("en", "builder.blockCount", 1)).toBe("1 block");
    expect(say("en", "builder.blockCount", 0)).toBe("0 blocks");
    expect(say("pl", "builder.blockCount", 1)).toBe("1 blok");
    expect(say("pl", "builder.blockCount", 2)).toBe("2 bloki");
    expect(say("pl", "builder.blockCount", 5)).toBe("5 bloków");
    expect(say("pl", "builder.blockCount", 22)).toBe("22 bloki");
    expect(say("pl", "builder.blockCount", 25)).toBe("25 bloków");
    expect(say("ru", "builder.blockCount", 21)).toBe("21 блок");
    expect(say("uk", "builder.blockCount", 3)).toBe("3 блоки");
    expect(say("fr", "builder.blockCount", 0)).toBe("0 bloc");
  });

  /** Messages with a count outside the builder (justflows-ce#312), spot-checked with 1, 2, 5 and 22. */
  it("read correctly for every count in Polish, Russian and Ukrainian", () => {
    const spot = (locale: string, key: string) => [1, 2, 5, 22].map((n) => say(locale, key, n));
    expect(spot("pl", "media.fileCount")).toEqual(["1 plik", "2 pliki", "5 plików", "22 pliki"]);
    expect(spot("ru", "media.fileCount")).toEqual(["1 файл", "2 файла", "5 файлов", "22 файла"]);
    expect(spot("uk", "media.fileCount")).toEqual(["1 файл", "2 файли", "5 файлів", "22 файли"]);
    expect(spot("pl", "comments.deleteConfirm")).toEqual(["Trwale usunąć 1 komentarz?", "Trwale usunąć 2 komentarze?", "Trwale usunąć 5 komentarzy?", "Trwale usunąć 22 komentarze?"]);
    expect(spot("ru", "health.hooks.errorsCount")).toEqual(["1 ошибка", "2 ошибки", "5 ошибок", "22 ошибки"]);
    expect(spot("uk", "marketplace.resultsCount")).toEqual(["1 результат", "2 результати", "5 результатів", "22 результати"]);
    expect(say("ru", "media.fileCount", 21)).toBe("21 файл");
    expect(say("en", "extensionUpdates.availableCount", 1)).toBe("1 update available");
    expect(say("de", "comments.deleteConfirm", 1)).toBe("1 Kommentar dauerhaft löschen?");
  });

  it("leave no plural-in-brackets after a count in any admin language", () => {
    const bracketed = /\((?:s|e|en|es|n|x|ы|и|я|е)\)/;
    for (const locale of ["en", "nl", "de", "fr", "es", "pl", "ru", "uk"]) {
      const offenders = Object.entries(catalog(locale)).filter(([, value]) => value.includes("{count}") && bracketed.test(value));
      expect(offenders.map(([key]) => key), locale).toEqual([]);
    }
  });

  it("fall back to `other`, then to English, and never break plain messages", () => {
    expect(lookupMessage({ "x.other": "{count} things" }, "x", "pl", { count: 1 })).toBe("{count} things");
    expect(lookupMessage({}, "builder.blockCount", "nl", { count: 1 })).toBeUndefined();
    expect(translateEnglish("builder.blockCount", { count: 1 })).toBe("1 block");
    expect(translateEnglish("builder.blockCount", { count: 7 })).toBe("7 blocks");
    expect(lookupMessage({ plain: "Hello" }, "plain", "pl", { count: 2 })).toBe("Hello");
  });
});
