// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { installedEnvContents, type InstallConfig } from "../install-state.js";

const config: InstallConfig = {
  dbDriver: "mysql",
  dbHost: "localhost",
  dbPort: 3306,
  dbName: "justflows",
  dbUser: "db_user",
  dbPassword: "db-secret",
  databaseUrl: "mysql://db_user:db-secret@localhost:3306/justflows",
  appUrl: "https://example.com",
  appSecret: "a".repeat(48),
  siteId: "site-1",
  installedAt: "2026-08-27T00:00:00.000Z",
  version: "0.1.5",
};

describe("installedEnvContents", () => {
  it("writes cache fully disabled on a fresh install", () => {
    const env = installedEnvContents(config);
    expect(env).toMatch(/^CACHE_ENABLED=0$/m);
    expect(env).toMatch(/^DATABASE_DRIVER=mysql$/m);
    expect(env).toMatch(/^CACHE_REVALIDATE_ENABLED=0$/m);
    expect(env).toMatch(/^JF_BROWSER_CACHE_ENABLED=0$/m);
    expect(env).toMatch(/^JF_GZIP_ENABLED=0$/m);
    expect(env).not.toMatch(/^CACHE_ENABLED=1$/m);
    expect(env).not.toMatch(/^JF_BROWSER_CACHE_ENABLED=1$/m);
    expect(env).not.toMatch(/^JF_GZIP_ENABLED=1$/m);
  });
});
