// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  contentTimestamp,
  translationGroupDates,
} from "../../../src/lib/content/translation-dates.js";

function fakeDb(row: Record<string, unknown> | undefined) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    query: async <T>(sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return (row ? [row] : []) as T[];
    },
  };
}

describe("translationGroupDates", () => {
  it("reads the earliest dates of the other entries in the group", async () => {
    const db = fakeDb({
      created_at: "2026-10-28 17:50:54",
      published_at: new Date("2026-10-28T17:54:29Z"),
    });

    const dates = await translationGroupDates("site-1", "group-1", "entry-2", db);

    expect(dates).toEqual({
      createdAt: "2026-10-28T17:50:54.000Z",
      publishedAt: "2026-10-28T17:54:29.000Z",
    });
    expect(db.calls[0]!.params).toEqual(["site-1", "group-1", "entry-2"]);
    expect(db.calls[0]!.sql).toMatch(/COALESCE\(translation_group_id, id\) = \?/);
    expect(db.calls[0]!.sql).toMatch(/id <> \?/);
  });

  it("returns nulls when no other entry has the dates", async () => {
    const db = fakeDb({ created_at: null, published_at: null });

    expect(await translationGroupDates("site-1", "group-1", "entry-1", db)).toEqual({
      createdAt: null,
      publishedAt: null,
    });
  });
});

describe("contentTimestamp", () => {
  it("writes the UTC form that new rows use", () => {
    expect(contentTimestamp("2026-10-28T17:50:54.000Z")).toBe("2026-10-28 17:50:54");
  });
});
