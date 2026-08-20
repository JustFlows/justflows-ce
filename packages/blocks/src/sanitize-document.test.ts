import { describe, expect, it } from "vitest";
import { sanitizeBlockDocument } from "./sanitize-document.js";

describe("sanitizeBlockDocument", () => {
  it("strips script tags from html blocks", () => {
    const result = sanitizeBlockDocument({
      version: 1,
      blocks: [
        {
          id: "1",
          type: "core.html",
          version: 1,
          props: { html: '<p>ok</p><script>alert(1)</script>' },
        },
      ],
    });
    const html = (result.blocks[0] as { props: { html: string } }).props.html;
    expect(html).toContain("<p>ok</p>");
    expect(html).not.toContain("script");
  });

  it("rejects javascript: urls", () => {
    const result = sanitizeBlockDocument({
      version: 1,
      blocks: [
        {
          id: "1",
          type: "core.button",
          version: 1,
          props: { url: "javascript:alert(1)", label: "Go" },
        },
      ],
    });
    expect((result.blocks[0] as { props: { url: string } }).props.url).toBe("#");
  });
});
