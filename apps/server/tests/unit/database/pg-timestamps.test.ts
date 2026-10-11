// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { PG_UTC_TIMESTAMP } from "../../../src/lib/database/db.js";

describe("PostgreSQL timestamps", () => {
  it("writes a zone-less timestamp as UTC, whatever the server's time zone", () => {
    expect(PG_UTC_TIMESTAMP.serialize("2026-10-02 09:30:15")).toBe("2026-10-02T09:30:15.000Z");
    expect(PG_UTC_TIMESTAMP.serialize("2026-10-02T09:30:15.250")).toBe("2026-10-02T09:30:15.250Z");
    expect(PG_UTC_TIMESTAMP.serialize("2026-10-02 09:30")).toBe("2026-10-02T09:30:00.000Z");
  });

  it("keeps timestamps that carry a zone and Date objects", () => {
    expect(PG_UTC_TIMESTAMP.serialize("2026-10-02T11:30:15+02:00")).toBe("2026-10-02T09:30:15.000Z");
    expect(PG_UTC_TIMESTAMP.serialize("2026-10-02T09:30:15Z")).toBe("2026-10-02T09:30:15.000Z");
    expect(PG_UTC_TIMESTAMP.serialize(new Date("2026-10-02T09:30:15Z"))).toBe("2026-10-02T09:30:15.000Z");
  });

  it("reads TIMESTAMP (no zone) as UTC and TIMESTAMPTZ by its zone", () => {
    expect(PG_UTC_TIMESTAMP.parse("2026-10-02 09:30:15").toISOString()).toBe("2026-10-02T09:30:15.000Z");
    expect(PG_UTC_TIMESTAMP.parse("2026-10-02 09:30:15.5").toISOString()).toBe("2026-10-02T09:30:15.500Z");
    expect(PG_UTC_TIMESTAMP.parse("2026-10-02 09:30:15+00").toISOString()).toBe("2026-10-02T09:30:15.000Z");
    expect(PG_UTC_TIMESTAMP.parse("2026-10-02 11:30:15+02").toISOString()).toBe("2026-10-02T09:30:15.000Z");
  });
});
