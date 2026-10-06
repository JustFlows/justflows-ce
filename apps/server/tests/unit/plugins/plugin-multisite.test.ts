// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { manifestAllowsMultisite, mayDropPluginTables } from "../../../src/lib/plugins/plugin-multisite.js";

describe("plugin multisite", () => {
  it("reads allowMultisite from the manifest", () => {
    expect(manifestAllowsMultisite({ allowMultisite: true })).toBe(true);
    expect(manifestAllowsMultisite({ allowMultisite: false })).toBe(false);
    expect(manifestAllowsMultisite({})).toBe(false);
    expect(manifestAllowsMultisite(null)).toBe(false);
  });

  it("drops tables only on the main site when no other site has the plugin", () => {
    expect(mayDropPluginTables({ installationRoot: true, otherSitesUsePlugin: false })).toBe(true);
    expect(mayDropPluginTables({ installationRoot: true, otherSitesUsePlugin: true })).toBe(false);
    expect(mayDropPluginTables({ installationRoot: false, otherSitesUsePlugin: false })).toBe(false);
    expect(mayDropPluginTables({ installationRoot: false, otherSitesUsePlugin: true })).toBe(false);
  });
});
