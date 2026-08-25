import { describe, expect, it } from "vitest";
import { isHomeContentSlug, parseHomePageId } from "../home-page.js";

describe("parseHomePageId", () => {
  it("accepts a UUID and rejects anything else", () => {
    expect(parseHomePageId("2c1d0e8a-4b3f-41a2-9c7d-0e1f2a3b4c5d")).toBe(
      "2c1d0e8a-4b3f-41a2-9c7d-0e1f2a3b4c5d",
    );
    expect(parseHomePageId(" 2c1d0e8a-4b3f-41a2-9c7d-0e1f2a3b4c5d ")).toBe(
      "2c1d0e8a-4b3f-41a2-9c7d-0e1f2a3b4c5d",
    );
    expect(parseHomePageId("home")).toBeNull();
    expect(parseHomePageId(null)).toBeNull();
    expect(parseHomePageId(12)).toBeNull();
  });
});

describe("isHomeContentSlug", () => {
  const home = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    slug: "welcome",
    translationGroupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  };

  it("matches the home page itself or a translation in the same group", () => {
    expect(isHomeContentSlug({ id: home.id, slug: "welcome" }, home as never)).toBe(true);
    expect(
      isHomeContentSlug(
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          slug: "welkom",
          translationGroupId: home.translationGroupId,
        },
        home as never,
      ),
    ).toBe(true);
    expect(
      isHomeContentSlug(
        { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", slug: "welcome" },
        home as never,
      ),
    ).toBe(false);
  });
});
