// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
const query = vi.fn();
const execute = vi.fn();
vi.mock("../../../src/lib/database/db.js", () => ({
  getDb: async () => ({ run, query, execute }),
}));
vi.mock("../../../src/lib/database/run-migrations.js", () => ({
  runAllMigrations: async () => undefined,
}));

import { createPinnedPluginDataApi } from "../../../src/lib/plugins/plugin-data.js";

beforeEach(() => {
  run.mockReset();
  query.mockReset().mockResolvedValue([]);
  execute.mockReset();
});

describe("plugin data concurrent writes", () => {
  it("updates the row when another request wins the insert race", async () => {
    execute.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    run.mockRejectedValueOnce(new Error("duplicate key value violates unique constraint"));

    await expect(
      createPinnedPluginDataApi("justflows.analytics", "site-1").put("daily", "2026-11-04", { views: 2 }),
    ).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("reports a lost CAS insert race as a normal conflict", async () => {
    execute.mockResolvedValue(0);
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "winner" }]);
    run.mockRejectedValueOnce(new Error("Duplicate entry"));

    await expect(
      createPinnedPluginDataApi("justflows.analytics", "site-1").cas("daily", "2026-11-04", "missing", { views: 2 }),
    ).resolves.toBe(false);
  });
});
