// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { parseProvisionedDatabase } from "../../../src/lib/installation/provisioned-database.js";

/** What the Plesk extension writes, minus unrelated keys. */
const PROVISIONED: Record<string, string> = {
  DB_PROVISIONED: "true",
  DB_DRIVER: "mariadb",
  DB_HOST: "localhost",
  DB_PORT: "3306",
  DB_NAME: "jf_d2d33916fe",
  DB_USER: "jfd2d33916fe",
  DB_PASSWORD: "Jf1-abc_DEF-123",
};

function env(overrides: Record<string, string | undefined> = {}): Map<string, string> {
  const merged = { ...PROVISIONED, ...overrides };
  return new Map(Object.entries(merged).filter((e): e is [string, string] => e[1] !== undefined));
}

describe("parseProvisionedDatabase", () => {
  it("reads a database the host provisioned", () => {
    expect(parseProvisionedDatabase(env())).toEqual({
      driver: "mariadb",
      host: "localhost",
      port: 3306,
      database: "jf_d2d33916fe",
      username: "jfd2d33916fe",
      password: "Jf1-abc_DEF-123",
    });
  });

  it("ignores DB_* settings without the explicit marker", () => {
    expect(parseProvisionedDatabase(env({ DB_PROVISIONED: undefined }))).toBeNull();
    expect(parseProvisionedDatabase(env({ DB_PROVISIONED: "false" }))).toBeNull();
  });

  it("accepts common truthy spellings and quoted values", () => {
    const parsed = parseProvisionedDatabase(env({ DB_PROVISIONED: "1", DB_PASSWORD: '"p a\\"ss"', DB_NAME: "'jf_db'" }));
    expect(parsed?.password).toBe('p a"ss');
    expect(parsed?.database).toBe("jf_db");
  });

  it("allows an empty password but not a missing one", () => {
    expect(parseProvisionedDatabase(env({ DB_PASSWORD: "" }))?.password).toBe("");
    expect(parseProvisionedDatabase(env({ DB_PASSWORD: undefined }))).toBeNull();
  });

  it.each([
    ["unknown driver", { DB_DRIVER: "sqlite" }],
    ["missing host", { DB_HOST: "" }],
    ["port out of range", { DB_PORT: "70000" }],
    ["non-numeric port", { DB_PORT: "33o6" }],
    ["missing name", { DB_NAME: undefined }],
    ["missing user", { DB_USER: "" }],
  ])("refuses incomplete settings: %s", (_label, overrides) => {
    expect(parseProvisionedDatabase(env(overrides))).toBeNull();
  });
});
