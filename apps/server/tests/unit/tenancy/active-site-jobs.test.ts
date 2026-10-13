// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), legacySite: vi.fn() }));
vi.mock("../../../src/lib/database/db.js", () => ({ getControlDb: async () => ({ query: m.query }) }));
vi.mock("../../../src/lib/settings/site-settings.js", () => ({ getSiteId: m.legacySite }));
import { activeSiteIds, eachActiveSite } from "../../../src/lib/tenancy/connections.js";
beforeEach(() => { vi.resetAllMocks(); m.legacySite.mockResolvedValue("inactive"); });
describe("background work on active sites", () => {
 it("does not fall back to a suspended site when no workspaces are active", async () => {
   m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "inactive" }]);
   const work = vi.fn();
   await eachActiveSite(work);
   expect(work).not.toHaveBeenCalled();
   expect(m.legacySite).not.toHaveBeenCalled();
   expect(m.query).toHaveBeenCalledWith(expect.stringContaining("s.status = 'active' AND t.status = 'active'"), []);
 });
 it("does not perform work when the registry is unreachable", async () => {
   m.query.mockRejectedValue(new Error("connection refused"));
   const work = vi.fn();
   await expect(eachActiveSite(work)).rejects.toThrow("connection refused");
   expect(work).not.toHaveBeenCalled();
 });
 it("keeps pre-tenancy single-site support", async () => {
   m.query.mockRejectedValue({ code: "42P01" });
   const work = vi.fn();
   await eachActiveSite(work);
   expect(work).toHaveBeenCalledWith("inactive");
 });
});

describe("bounded registry activity checks", () => {
 it("checks deduplicated sites in bounded batches", async () => {
   m.query.mockImplementation(async (_sql, ids) => ids.map((id: string) => ({ id })));
   const ids = Array.from({ length: 220 }, (_, i) => `site-${i}`);
   expect((await activeSiteIds([...ids, ...ids])).size).toBe(220);
   expect(m.query).toHaveBeenCalledTimes(3);
   expect(m.query.mock.calls.every((call) => call[1].length <= 100)).toBe(true);
 });
 it("excludes suspended sites and avoids queries for empty input", async () => {
   expect((await activeSiteIds([])).size).toBe(0);
   expect(m.query).not.toHaveBeenCalled();
   m.query.mockResolvedValue([{ id: "active" }]);
   expect(await activeSiteIds(["active", "suspended"])).toEqual(new Set(["active"]));
 });
});
