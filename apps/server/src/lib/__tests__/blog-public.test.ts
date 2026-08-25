import { describe, expect, it } from "vitest";
import { parseBlogPostListProps } from "../blog-public.js";

describe("parseBlogPostListProps", () => {
  it("applies defaults when props are empty", () => {
    const props = parseBlogPostListProps({});
    expect(props).toEqual({
      layout: "grid",
      columns: 3,
      showExcerpt: true,
      showDate: true,
      showFeaturedImage: true,
      postsPerPage: null,
    });
  });

  it("falls back to grid for an unknown layout", () => {
    expect(parseBlogPostListProps({ layout: "carousel" }).layout).toBe("grid");
    expect(parseBlogPostListProps({ layout: "list" }).layout).toBe("list");
  });

  it("clamps columns to 1-4, defaulting an unset/zero value to 3", () => {
    expect(parseBlogPostListProps({ columns: 1 }).columns).toBe(1);
    expect(parseBlogPostListProps({ columns: 99 }).columns).toBe(4);
    expect(parseBlogPostListProps({ columns: 0 }).columns).toBe(3);
  });

  it("treats a zero or empty postsPerPage as unset", () => {
    expect(parseBlogPostListProps({ postsPerPage: 0 }).postsPerPage).toBeNull();
    expect(parseBlogPostListProps({ postsPerPage: "" }).postsPerPage).toBeNull();
    expect(parseBlogPostListProps({ postsPerPage: 5 }).postsPerPage).toBe(5);
    expect(parseBlogPostListProps({ postsPerPage: 500 }).postsPerPage).toBe(100);
  });

  it("reads boolean toggles, defaulting to true", () => {
    const props = parseBlogPostListProps({ showExcerpt: false, showDate: "false", showFeaturedImage: false });
    expect(props.showExcerpt).toBe(false);
    expect(props.showDate).toBe(false);
    expect(props.showFeaturedImage).toBe(false);
  });
});
