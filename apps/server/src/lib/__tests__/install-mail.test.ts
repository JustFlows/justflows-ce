// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { buildInstallDetailsEmail } from "../install-mail.js";

const input = {
  to: "admin@example.com",
  siteName: "Acme",
  siteUrl: "https://acme.example/",
  locale: "nl-NL",
  localeName: "Dutch",
  username: "admin",
  email: "admin@example.com",
  password: "super-secret-password",
  dbDriver: "mysql",
  dbHost: "localhost",
  dbPort: 3306,
  dbName: "justflows",
  dbUser: "db_user",
};

describe("buildInstallDetailsEmail", () => {
  it("includes site details and admin credentials, not the database password", () => {
    const mail = buildInstallDetailsEmail(input);
    expect(mail.subject).toContain("Acme");
    expect(mail.text).toContain("https://acme.example");
    expect(mail.text).toContain("https://acme.example/admin");
    expect(mail.text).toContain("Username: admin");
    expect(mail.text).toContain("Password: super-secret-password");
    expect(mail.text).toContain("Default language: Dutch (nl-NL)");
    expect(mail.text).toContain("Type: mysql");
    expect(mail.text).toContain("Username: db_user");
    expect(mail.text).not.toContain("db-password");
  });
});
