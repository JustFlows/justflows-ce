import { afterEach, describe, expect, it } from "vitest";
import { settingsKeyColumn, settingsKeyColumnFor } from "../site-settings.js";

const original = process.env.DB_DRIVER;
afterEach(() => {
  if (original === undefined) delete process.env.DB_DRIVER;
  else process.env.DB_DRIVER = original;
});

describe("settingsKeyColumn", () => {
  // `key` is reserved in MySQL/MariaDB and must be backticked; in PostgreSQL a
  // backtick is not a quote character at all, so the MySQL form was a syntax
  // error there — and it was hardcoded into every settings read.
  it("quotes for MySQL and MariaDB", () => {
    for (const driver of ["mysql", "mariadb"]) {
      process.env.DB_DRIVER = driver;
      expect(settingsKeyColumn()).toBe("`key`");
      expect(settingsKeyColumnFor(driver)).toBe("`key`");
    }
  });

  it("leaves the identifier bare on PostgreSQL", () => {
    process.env.DB_DRIVER = "postgres";
    expect(settingsKeyColumn()).toBe("key");
  });

  it("falls back to the quoted form when the driver is unset", () => {
    delete process.env.DB_DRIVER;
    expect(settingsKeyColumn()).toBe("`key`");
  });

  it("never emits a quote character PostgreSQL would reject", () => {
    process.env.DB_DRIVER = "postgres";
    expect(settingsKeyColumn()).not.toContain("`");
  });
});
