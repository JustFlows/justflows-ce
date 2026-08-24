import { describe, expect, it } from "vitest";
import { logSafe } from "../log-safe.js";

describe("logSafe", () => {
  it("strips CR/LF/TAB and percent so values cannot inject logs or format strings", () => {
    expect(logSafe("GET\r\nSet-Cookie: x\t%ssneaky")).toBe("GETSet-Cookie: x__ssneaky");
  });

  it("truncates long values", () => {
    expect(logSafe("a".repeat(300), 16)).toBe("a".repeat(16));
  });
});
