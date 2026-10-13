// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobQueueRow } from "../../../src/lib/jobs/job-queue-db.js";

const state = vi.hoisted(() => ({
  row: null as null | { filename: string; mime_type: string; storage_key: string; derivative_bytes: number; trashed_at: unknown },
  trashedAfter: false,
  runs: [] as Array<{ sql: string; params: unknown[] }>,
  generate: vi.fn(),
  record: vi.fn(async () => undefined),
  moveDir: vi.fn(async () => undefined),
  removeDir: vi.fn(async () => undefined),
}));

vi.mock("../../../src/lib/database/db.js", () => ({
  getDb: async () => ({
    async query(sql: string) {
      if (sql.startsWith("SELECT trashed_at")) return state.row ? [{ trashed_at: state.trashedAfter ? "now" : null }] : [];
      return state.row ? [state.row] : [];
    },
    async run(sql: string, params: unknown[]) {
      state.runs.push({ sql, params });
    },
  }),
}));
vi.mock("../../../src/lib/tenancy/provision.js", () => ({
  runWithSiteDatabase: (_siteId: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../../../src/lib/media/upload-store.js", () => ({ readUpload: async () => Buffer.from("png") }));
vi.mock("../../../src/lib/media/media-write.js", () => ({ recordVariants: state.record }));
vi.mock("../../../src/lib/media/media-responsive.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/lib/media/media-responsive.js")>()),
  generateAndStoreVariants: state.generate,
  moveVariantDir: state.moveDir,
  removeVariantDir: state.removeDir,
}));

import { runMediaVariantJob } from "../../../src/lib/media/media-variant-jobs.js";
import { DerivativeBudgetError } from "../../../src/lib/media/media-responsive.js";

const SITE = "00000000-0000-4000-8000-000000000001";
const job = (attempts = 1): JobQueueRow => ({
  id: "job",
  jobName: "core.media-variants",
  siteId: SITE,
  payload: { mediaId: "m1" },
  status: "running",
  attempts,
  maxAttempts: 3,
  runAt: new Date(),
  lockedBy: "w",
  lockedUntil: null,
  lastError: null,
  createdAt: null,
} as JobQueueRow);
const set = { base: { w: 10, h: 10, format: "png" }, variants: [], widths: [], formats: ["webp"], generatedAt: "", totalBytes: 1 };
const released = () => state.runs.some((r) => r.sql.startsWith("UPDATE media SET derivative_bytes = 0"));

beforeEach(() => {
  state.row = { filename: "a.png", mime_type: "image/png", storage_key: `${SITE}/a.png`, derivative_bytes: 3000, trashed_at: null };
  state.trashedAfter = false;
  state.runs.length = 0;
  state.generate.mockReset();
  state.record.mockClear();
  state.moveDir.mockClear();
  state.removeDir.mockClear();
});

describe("media variant job", () => {
  it("builds the set within the upload's reservation and records it", async () => {
    state.generate.mockResolvedValue(set);
    expect(await runMediaVariantJob(job())).toEqual({ success: true });
    expect(state.generate).toHaveBeenCalledWith(expect.objectContaining({ siteId: SITE, mediaId: "m1", maxBytes: 3000 }));
    expect(state.record).toHaveBeenCalledWith(SITE, "m1", set);
  });

  it("releases the reservation without retrying when the set is too large", async () => {
    state.generate.mockRejectedValue(new DerivativeBudgetError("too big"));
    expect((await runMediaVariantJob(job())).success).toBe(true);
    expect(released()).toBe(true);
    expect(state.record).not.toHaveBeenCalled();
  });

  it("retries storage errors and keeps the reservation until the last attempt", async () => {
    state.generate.mockRejectedValue(new Error("S3 PUT failed"));
    await expect(runMediaVariantJob(job(1))).rejects.toThrow("S3 PUT failed");
    expect(released()).toBe(false);
    await expect(runMediaVariantJob(job(3))).rejects.toThrow("S3 PUT failed");
    expect(released()).toBe(true);
  });

  it("skips a trashed item and releases its reservation", async () => {
    state.row!.trashed_at = "now";
    expect((await runMediaVariantJob(job())).success).toBe(true);
    expect(state.generate).not.toHaveBeenCalled();
    expect(released()).toBe(true);
  });

  it("moves the files into the trash when the item was trashed while building", async () => {
    state.generate.mockResolvedValue(set);
    state.trashedAfter = true;
    await runMediaVariantJob(job());
    expect(state.moveDir).toHaveBeenCalledWith(SITE, "m1", true);
    expect(state.record).toHaveBeenCalled();
  });
});
