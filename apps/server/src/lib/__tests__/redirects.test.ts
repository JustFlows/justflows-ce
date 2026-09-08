// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  assertNoRedirectLoops,
  exportRedirectCsv,
  importRedirectCsv,
  matchRedirect,
  resolveRedirect,
  safeRedirectTarget,
  validateRedirect,
  type RedirectRule,
} from "../redirects.js";
const rule = (source: string, target: string, extra: Partial<RedirectRule> = {}): RedirectRule => ({
  id: source,
  source,
  target,
  kind: "exact",
  targetType: "internal",
  status: 301,
  enabled: true,
  ...extra,
});
describe("redirect validation", () => {
  it.each([
    "//evil.test",
    "/\\evil.test",
    "/%5cevil",
    "/%252f%252fevil",
    "/%0d%0aLocation:evil",
    "/a/../b",
    "/%2e%2e/b",
    "/a b",
    "/bad%",
    "javascript:alert(1)",
  ])("rejects unsafe internal destination %s", (target) => {
    expect(safeRedirectTarget(target)).toBe(false);
    const { id: _, ...input } = rule("/old", target);
    expect(() => validateRedirect(input)).toThrow();
  });
  it.each([
    "javascript:alert(1)",
    "https://user:pass@evil.test/",
    "//evil.test",
    "https://example.test/%0d%0a",
    "https:\\evil.test",
    "https://$1.test/",
  ])("rejects unsafe external destination %s", (target) => {
    const { id: _, ...input } = rule("/old/", target, { kind: "prefix", targetType: "external" });
    expect(() => validateRedirect(input)).toThrow();
  });
  it("accepts fixed external hosts and capture paths", () => {
    const { id: _, ...input } = rule("/old/", "https://example.test/new/$1", {
      kind: "prefix",
      targetType: "external",
    });
    expect(validateRedirect(input)).toEqual(input);
    expect(resolveRedirect([rule(input.source, input.target, input)], "/old/hello")).toMatchObject({
      target: "https://example.test/new/hello",
    });
  });
  it.each([
    "^/(a+)+$",
    "^/(.*)(.*)$",
    "^/(a|aa)+$",
    "^/(?=x)$",
    "^/(foo)$",
    "^/x/([^/]+)tail$",
    "^/(\\d+)+$",
    "^/(.*)/tail$",
  ])("rejects unrestricted regex %s", (source) => {
    const { id: _, ...input } = rule(source, "/new/$1", { kind: "regex" });
    expect(() => validateRedirect(input)).toThrow();
  });
  it("matches safe regex capture groups and prefixes", () => {
    const regex = rule("^/old/(\\d+)/([^/]+)$", "/new/$2/$1", { kind: "regex" });
    const { id: _, ...input } = regex;
    expect(validateRedirect(input)).toEqual(input);
    expect(resolveRedirect([regex], "/old/42/title")).toMatchObject({ target: "/new/title/42" });
    expect(matchRedirect(rule("/old/", "/new/$1", { kind: "prefix" }), "/older/x")).toBeNull();
  });
  it("supports long exact 404 sources but bounds regex expressions", () => {
    const { id: _, ...input } = rule("/" + "a".repeat(1500), "/new");
    expect(validateRedirect(input).source).toHaveLength(1501);
    expect(() =>
      validateRedirect({ ...input, kind: "regex", source: "^/" + "a".repeat(512) + "$" }),
    ).toThrow();
  });
  it("rejects arbitrary query sources and missing captures", () => {
    for (const r of [
      rule("/a?token=x", "/b"),
      rule("/a", "/b/$1"),
      rule("/a", "/b", { status: 303 as 301 }),
    ]) {
      const { id: _, ...input } = r;
      expect(() => validateRedirect(input)).toThrow();
    }
  });
});
describe("precedence, loops and chains", () => {
  it("prefers exact, longest prefix, then regex, and ignores disabled rules", () => {
    const rules = [
      rule("^/old/(.*)$", "/regex", { kind: "regex" }),
      rule("/old/", "/prefix", { kind: "prefix" }),
      rule("/old/deep/", "/deep", { kind: "prefix" }),
      rule("/old/deep/x", "/exact"),
    ];
    expect(resolveRedirect(rules, "/old/deep/x")?.target).toBe("/exact");
    expect(resolveRedirect(rules, "/old/deep/y")?.target).toBe("/deep");
    expect(
      resolveRedirect(
        rules.map((r) => ({ ...r, enabled: false })),
        "/old/deep/x",
      ),
    ).toBeNull();
  });
  it("collapses equal statuses but preserves mixed status semantics", () => {
    expect(resolveRedirect([rule("/a", "/b"), rule("/b", "/c")], "/a")).toMatchObject({
      target: "/c",
      status: 301,
      chain: ["/a", "/b"],
    });
    expect(
      resolveRedirect([rule("/a", "/b"), rule("/b", "/c", { status: 302 })], "/a")?.target,
    ).toBe("/b");
  });
  it.each([
    [rule("/a", "/a")],
    [rule("/a", "/b"), rule("/b", "/a", { status: 302 })],
    [rule("/a", "/a#section")],
    [rule("/a", "/a?utm_source=x")],
    [rule("/a/", "/a/new/$1", { kind: "prefix" })],
  ])("rejects actual or potential cycles", (...rules) => {
    expect(() => assertNoRedirectLoops(rules)).toThrow(/loop|cyclic/);
    expect(resolveRedirect(rules, rules[0]!.source)).toBeNull();
  });
  it("rejects chains that exceed the public evaluation limit", () => {
    const chain = Array.from({ length: 33 }, (_, i) => rule(`/hop${i}`, `/hop${i + 1}`));
    expect(() => assertNoRedirectLoops(chain)).toThrow(/32 hops/);
    expect(() => assertNoRedirectLoops(chain.slice(0, 32))).not.toThrow();
  });
  it("preserves inherited fragments when collapsing chains", () => {
    expect(resolveRedirect([rule("/a", "/b#section"), rule("/b", "/c")], "/a")?.target).toBe(
      "/c#section",
    );
    expect(resolveRedirect([rule("/a", "/b#section"), rule("/b", "/c#other")], "/a")?.target).toBe(
      "/c#other",
    );
  });
  it("gives managed patterns priority over history and canonicalization", () => {
    const rules = [
      rule("/a/", "/replacement", { kind: "prefix" }),
      rule("/a/old", "/historic", { id: "history:/a/old" }),
    ];
    expect(resolveRedirect(rules, "/a/old")?.target).toBe("/replacement");
    expect(
      resolveRedirect([rule("/a", "/b/"), rule("/b/", "/override")], "/a", () => "/canonical")
        ?.target,
    ).toBe("/canonical");
    expect(
      resolveRedirect([rule("/a", "/b/"), rule("/b/", "/override")], "/a", (path) =>
        path === "/b/" ? "/b" : path,
      )?.target,
    ).toBe("/override");
  });
  it("detects cycles through captures with a specific value", () => {
    expect(() =>
      assertNoRedirectLoops([
        rule("/a/", "/b/$1", { kind: "prefix" }),
        rule("/b/special", "/a/special"),
      ]),
    ).toThrow();
  });
  it("blocks unsafe capture substitution and checks canonical destinations", () => {
    expect(
      resolveRedirect([rule("^/old/(.*)$", "/$1", { kind: "regex" })], "/old//evil.test"),
    ).toBeNull();
    expect(
      resolveRedirect([rule("/a", "/a/")], "/a", (path) => path.replace(/\/$/, "")),
    ).toBeNull();
  });
});
describe("CSV", () => {
  it("round-trips quoted fields, commas, regex, status and disabled rules", () => {
    const rules = [
      rule("/old", "/new?q=hello,world", { enabled: false }),
      rule("^/old/([^/]+)$", "/new/$1", { kind: "regex", status: 308 }),
    ];
    expect(importRedirectCsv(exportRedirectCsv(rules))).toEqual(
      rules.map(({ id: _, ...input }) => input),
    );
  });
  it.each([
    "source,kind\n/a,exact",
    'source,kind,targetType,target,status,enabled\n"/old,exact,internal,/new,301,true',
    "source,kind,targetType,target,status,enabled\n/a,exact,internal,/b,301,yes",
    "source,kind,targetType,target,status,enabled\n/a,exact,external,javascript:evil,301,true",
  ])("rejects malformed CSV", (csv) => expect(() => importRedirectCsv(csv)).toThrow());
  it("bounds input size and row count", () => {
    expect(() => importRedirectCsv("x".repeat(1048577))).toThrow(/MiB/);
    expect(() =>
      importRedirectCsv(
        exportRedirectCsv(Array.from({ length: 501 }, (_, i) => rule(`/a${i}`, "/b"))),
      ),
    ).toThrow(/500/);
  });
});
