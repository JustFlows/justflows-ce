// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it } from "vitest";
import { mcpResourceUrl, publicOrigin } from "../../../src/lib/ai/ai-settings.js";
import { runWithTenant, type TenantRequestContext } from "../../../src/lib/tenancy/context.js";

const req = {
  protocol: "https",
  get: () => "ignored.example",
};

function tenant(hostname: string): TenantRequestContext {
  return {
    tenantId: "tenant-1",
    siteId: "site-1",
    hostname,
    userMode: "isolated",
    databaseMode: "separate",
    rootSite: false,
    activePluginIds: null,
  };
}

describe("publicOrigin", () => {
  const previous = process.env.APP_URL;
  afterEach(() => {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  });

  it("advertises the site being served, not the installation APP_URL", () => {
    process.env.APP_URL = "https://platform.example.com";
    const origin = runWithTenant(tenant("dirkswebsite.example.com"), () => publicOrigin(req));
    expect(origin).toBe("https://dirkswebsite.example.com");
    expect(runWithTenant(tenant("dirkswebsite.example.com"), () => mcpResourceUrl(req))).toBe(
      "https://dirkswebsite.example.com/api/mcp",
    );
  });

  it("keeps APP_URL when the request is not bound to a site", () => {
    process.env.APP_URL = "https://platform.example.com";
    expect(publicOrigin(req)).toBe("https://platform.example.com");
  });
});
