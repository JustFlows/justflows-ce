// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pluginRequirementError } from "../../../src/lib/plugins/plugin-requirements.js";

const query = vi.fn();
vi.mock("../../../src/lib/database/db.js", () => ({ getDb: async () => ({ query }) }));

const quotes = { id: "justflows.offers", requires: ["justflows.store"] };

beforeEach(() => {
  query.mockReset();
});

describe("plugin requirements", () => {
  it("refuses install when Store is not on this site", async () => {
    query.mockResolvedValue([]);
    expect(await pluginRequirementError("site-1", quotes, "install")).toBe(
      "Install Store before installing this plugin.",
    );
    expect(query).toHaveBeenCalledWith(
      "SELECT plugin_id, status FROM plugins WHERE site_id = ? AND plugin_id IN (?)",
      ["site-1", "justflows.store"],
    );
  });

  it("allows install when Store is installed but not active", async () => {
    query.mockResolvedValue([{ plugin_id: "justflows.store", status: "inactive" }]);
    expect(await pluginRequirementError("site-1", quotes, "install")).toBeNull();
  });

  it("refuses activation until Store is active", async () => {
    query.mockResolvedValue([]);
    expect(await pluginRequirementError("site-1", quotes, "activate")).toBe(
      "Install Store before activating this plugin.",
    );
    query.mockResolvedValue([{ plugin_id: "justflows.store", status: "installed" }]);
    expect(await pluginRequirementError("site-1", quotes, "activate")).toBe(
      "Activate Store before activating this plugin.",
    );
  });

  it("allows activation when Store is active and ignores a plugin with no requirement", async () => {
    query.mockResolvedValue([{ plugin_id: "justflows.store", status: "active" }]);
    expect(await pluginRequirementError("site-1", quotes, "activate")).toBeNull();
    expect(await pluginRequirementError("site-1", { id: "justflows.vault" }, "install")).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
