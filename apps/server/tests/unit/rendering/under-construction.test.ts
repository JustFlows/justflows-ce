// SPDX-License-Identifier: MIT
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { describe, expect, it } from "vitest";
import { createTranslator } from "../../../src/lib/i18n/translate.js";

const template = fileURLToPath(new URL("../../../src/views/under-construction.ejs", import.meta.url));

describe("under-construction translations", () => {
  for (const locale of ["en", "nl", "de", "fr", "es"]) {
    it(`renders the ${locale} catalog and escapes site-provided text`, async () => {
      const catalog = JSON.parse(fs.readFileSync(new URL(`../../../src/lib/i18n/site-catalogs/${locale}.json`, import.meta.url), "utf8"));
      const render = (tagline: string) => ejs.renderFile(template, {
        locale, t: createTranslator(catalog), siteTitle: "<Example>",
        tagline, justflowsVersion: "test", faviconHead: "",
      });
      const html = await render("");
      expect(html).toContain(`lang="${locale}"`);
      expect(html).toContain(catalog["construction.heading"]);
      expect(html).toContain(catalog["construction.body"]);
      expect(html).toContain(catalog["footer.powered_by"]);
      expect(html).toContain("&lt;Example&gt;");
      expect(html).not.toContain("construction.");
      const custom = await render("<Custom tagline>");
      expect(custom).toContain("&lt;Custom tagline&gt;");
      expect(custom).not.toContain(catalog["construction.body"]);
    });
  }
});
