import { describe, expect, it } from "vitest";
import { validateWorkspaceEdit } from "../../../src/lib/tenancy/workspace-record.js";

function context(overrides: Partial<Parameters<typeof validateWorkspaceEdit>[1]> = {}): Parameters<typeof validateWorkspaceEdit>[1] {
  return { currentStatus: "active", currentSlug: "acme", takenSlugs: new Set(), ...overrides };
}

describe("workspace edit", () => {
  it("trims the name and lowercases the slug", () => {
    expect(validateWorkspaceEdit({ name: "  Acme Inc  ", slug: "Acme-Two" }, context())).toEqual({
      ok: true,
      value: { name: "Acme Inc", slug: "acme-two" },
    });
  });

  it("rejects a slug with spaces or symbols", () => {
    expect(validateWorkspaceEdit({ name: "Acme", slug: "acme two" }, context()).ok).toBe(false);
    expect(validateWorkspaceEdit({ name: "Acme", slug: "-acme" }, context()).ok).toBe(false);
  });

  it("rejects a slug another workspace uses", () => {
    expect(validateWorkspaceEdit({ name: "Acme", slug: "beta" }, context({ takenSlugs: new Set(["beta"]) })).ok).toBe(false);
  });

  it("keeps the platform workspace on primary and reserves it", () => {
    expect(validateWorkspaceEdit({ name: "Platform", slug: "other" }, context({ currentSlug: "primary" })).ok).toBe(false);
    expect(validateWorkspaceEdit({ name: "Platform", slug: "primary" }, context({ currentSlug: "primary" })).ok).toBe(true);
    expect(validateWorkspaceEdit({ name: "Acme", slug: "primary" }, context()).ok).toBe(false);
  });

  it("refuses edits on a deleted workspace", () => {
    expect(validateWorkspaceEdit({ name: "Acme", slug: "acme" }, context({ currentStatus: "deleted" })).ok).toBe(false);
  });
});
