// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  adminPopupSettingOnThisSite,
  adminSupportAudience,
  pointHelpdeskPopupAt,
  supportLink,
  supportPageOrigin,
  supportSiteChoices,
} from "../../../src/lib/admin/admin-support-popup.js";

describe("admin support popup", () => {
  it("hides the button on the main site once other sites exist", () => {
    expect(adminSupportAudience({ requestIsRoot: true, siteCount: 2 })).toBe("none");
  });

  it("keeps the button on the only site", () => {
    expect(adminSupportAudience({ requestIsRoot: true, siteCount: 1 })).toBe("this-site");
  });

  it("sends another site's admin to the main site's switch", () => {
    expect(adminSupportAudience({ requestIsRoot: false, siteCount: 2 })).toBe("main-site");
  });

  it("keeps the admin popup switch on the main site only", () => {
    expect(adminPopupSettingOnThisSite(true)).toBe(true);
    expect(adminPopupSettingOnThisSite(false)).toBe(false);
  });

  it("builds the main site's support address without dropping the dev port", () => {
    expect(supportPageOrigin("localhost", "3000")).toBe("http://localhost:3000");
    expect(supportPageOrigin("demo-site.localhost", "3000")).toBe("http://demo-site.localhost:3000");
    expect(supportPageOrigin("support.example", "3000")).toBe("https://support.example");
  });

  it("hides the support site choice until another site exists", () => {
    expect(supportSiteChoices([
      { siteId: "root", hostname: "platform.justflows.com", siteStatus: "active" },
    ], "root")).toBeNull();
  });

  it("lists other sites and leaves the choice unset", () => {
    expect(supportSiteChoices([
      { siteId: "root", hostname: "platform.justflows.com", siteStatus: "active" },
      { siteId: "support", hostname: "support.justflows.com", siteStatus: "active" },
      { siteId: "blog", hostname: "blog.justflows.com", siteStatus: "suspended" },
    ], "root")).toEqual([
      { value: "", label: "This site" },
      { value: "support", label: "support.justflows.com" },
    ]);
  });

  it("keeps support on this site until a different site is chosen", () => {
    const sites = [
      { siteId: "root", host: "platform.justflows.com", active: true },
      { siteId: "support", host: "support.justflows.com", active: true },
    ];
    expect(supportLink({
      currentSiteId: "blog",
      rootSiteId: "root",
      supportSiteId: "",
      sites,
    })).toBe("https://platform.justflows.com/support");
    expect(supportLink({
      currentSiteId: "blog",
      rootSiteId: "root",
      supportSiteId: "support",
      sites,
    })).toBe("https://support.justflows.com/support");
    expect(supportLink({
      currentSiteId: "support",
      rootSiteId: "root",
      supportSiteId: "support",
      sites,
    })).toBe("/support");
  });

  it("rewrites only the helpdesk popup link", () => {
    const html = `<script src="/ext/justflows.helpdesk/popup.js" data-jf-helpdesk-popup data-href="/support"></script>`;
    expect(pointHelpdeskPopupAt(html, "https://support.justflows.com/support")).toContain(
      'data-href="https://support.justflows.com/support"',
    );
    expect(pointHelpdeskPopupAt("<p>data-jf-helpdesk-popup</p>", "https://support.justflows.com/support")).toBe(
      "<p>data-jf-helpdesk-popup</p>",
    );
  });
});
