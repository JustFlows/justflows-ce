// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pluginRequirementError } from "../../../src/lib/plugins/plugin-requirements.js";

const query = vi.fn();
vi.mock("../../../src/lib/database/db.js", () => ({ getDb: async () => ({ query }) }));

const quotes = { id: "justflows.quotes", requires: ["justflows.shop"] };

beforeEach(() => {
  query.mockReset();
});

describe("plugin requirements", () => {
  it("refuses install when Shop is not on this site", async () => {
    query.mockResolvedValue([]);
    expect(await pluginRequirementError("site-1", quotes, "install")).toBe(
      "Install Shop before installing this plugin.",
    );
    expect(query).toHaveBeenCalledWith(
      "SELECT plugin_id, status FROM plugins WHERE site_id = ? AND plugin_id IN (?)",
      ["site-1", "justflows.shop"],
    );
  });

  it("allows install when Shop is installed but not active", async () => {
    query.mockResolvedValue([{ plugin_id: "justflows.shop", status: "inactive" }]);
    expect(await pluginRequirementError("site-1", quotes, "install")).toBeNull();
  });

  it("refuses activation until Shop is active", async () => {
    query.mockResolvedValue([]);
    expect(await pluginRequirementError("site-1", quotes, "activate")).toBe(
      "Install Shop before activating this plugin.",
    );
    query.mockResolvedValue([{ plugin_id: "justflows.shop", status: "installed" }]);
    expect(await pluginRequirementError("site-1", quotes, "activate")).toBe(
      "Activate Shop before activating this plugin.",
    );
  });

  it("allows activation when Shop is active and ignores a plugin with no requirement", async () => {
    query.mockResolvedValue([{ plugin_id: "justflows.shop", status: "active" }]);
    expect(await pluginRequirementError("site-1", quotes, "activate")).toBeNull();
    expect(await pluginRequirementError("site-1", { id: "justflows.shared-files" }, "install")).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
