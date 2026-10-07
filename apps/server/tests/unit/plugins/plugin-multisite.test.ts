// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  manifestAllowsMultisite,
  mayDropPluginTables,
  subsitePluginCopyIsStale,
} from "../../../src/lib/plugins/plugin-multisite.js";

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

  it("treats a same-version reinstall on the main site as a stale copy", () => {
    const old = { version: "0.1.2", manifest: { id: "justflows.shop", installedPath: "/p/0.1.2/aaaa" } };
    const reinstalled = { version: "0.1.2", manifest: { id: "justflows.shop", installedPath: "/p/0.1.2/bbbb" } };
    expect(subsitePluginCopyIsStale(old, reinstalled)).toBe(true);
    expect(subsitePluginCopyIsStale(old, { ...old, version: "0.1.3" })).toBe(true);
    expect(subsitePluginCopyIsStale(old, { ...old })).toBe(false);
    expect(subsitePluginCopyIsStale({ ...old, manifest: JSON.stringify(old.manifest) }, old)).toBe(false);
  });
});
