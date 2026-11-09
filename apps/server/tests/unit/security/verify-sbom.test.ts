// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
// @ts-expect-error Release script without type declarations.
import { sbomProblems } from "../../../../../scripts/verify-sbom.mjs";

const expected = { name: "justflows", version: "1.2.3", directDependencies: ["express"] };

function bom(overrides: Record<string, unknown> = {}) {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    metadata: { component: { name: "justflows", version: "1.2.3" } },
    components: [{ name: "express", version: "5.0.0", purl: "pkg:npm/express@5.0.0" }],
    ...overrides,
  };
}

describe("sbomProblems", () => {
  it("accepts a document that describes this release", () => {
    expect(sbomProblems(bom(), expected)).toEqual([]);
  });

  it("rejects a document that is not an object", () => {
    expect(sbomProblems(null, expected)).toEqual(["document is not a JSON object"]);
  });

  it("rejects the wrong format", () => {
    expect(sbomProblems(bom({ bomFormat: "SPDX" }), expected)).toContain("bomFormat is not CycloneDX");
  });

  it("rejects an SBOM from another version", () => {
    const stale = bom({ metadata: { component: { name: "justflows", version: "1.2.2" } } });
    expect(sbomProblems(stale, expected)).toContain("describes version 1.2.2, not 1.2.3");
  });

  it("rejects an empty component list", () => {
    expect(sbomProblems(bom({ components: [] }), expected)).toContain("lists no components");
  });

  it("rejects an incomplete component", () => {
    const components = [{ name: "express", version: "5.0.0" }];
    expect(sbomProblems(bom({ components }), expected)).toContain("incomplete component: express");
  });

  it("rejects a missing direct dependency", () => {
    const components = [{ name: "zod", version: "4.0.0", purl: "pkg:npm/zod@4.0.0" }];
    expect(sbomProblems(bom({ components }), expected)).toContain("missing direct dependency: express");
  });
});
