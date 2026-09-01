import { describe, expect, it } from "vitest";
import { toInternalAdminPath, toPublicAdminPath, validateAdminPath } from "../admin-path.js";

describe("admin path", () => {
  it("accepts a nested, unambiguous path", () => {
    expect(validateAdminPath("/private/control-room")).toBe("/private/control-room");
  });

  it.each([
    "/",
    "/admin",
    "/api/control",
    "/assets/control",
    "/control/",
    "/control//room",
    "/control/../room",
    "/control%2froom",
    "control-room",
  ])("rejects reserved or ambiguous path %s", (value) => {
    expect(() => validateAdminPath(value)).toThrow();
  });

  it("maps only the configured route boundary", () => {
    expect(toInternalAdminPath("/control-room/users", "/control-room")).toBe("/admin/users");
    expect(toInternalAdminPath("/control-roomish", "/control-room")).toBeNull();
    expect(toPublicAdminPath("/admin/users", "/control-room")).toBe("/control-room/users");
    expect(toPublicAdminPath("/administrator", "/control-room")).toBe("/administrator");
  });
});
