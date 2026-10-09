import { describe, expect, it } from "vitest";
import { checkMailAttachments } from "../../../src/lib/email/mail.js";

const pdf = (size = 10) => Buffer.alloc(size, 1);

describe("checkMailAttachments", () => {
  it("passes no attachments through as none", () => {
    expect(checkMailAttachments(undefined)).toBeUndefined();
  });

  it("keeps allowed files and cleans their names", () => {
    expect(checkMailAttachments([{ filename: '../INV-2026/00001".pdf', content: pdf(), contentType: "application/pdf; charset=binary" }])).toEqual([
      { filename: ".._INV-2026_00001_.pdf", content: pdf(), contentType: "application/pdf" },
    ]);
    expect(checkMailAttachments([{ filename: "", content: pdf(), contentType: "image/png" }])?.[0]?.filename).toBe("attachment");
  });

  it("refuses other types, empty files, too many, and too large", () => {
    expect(() => checkMailAttachments([{ filename: "x.html", content: pdf(), contentType: "text/html" }])).toThrow(/not allowed/);
    expect(() => checkMailAttachments([{ filename: "x.pdf", content: Buffer.alloc(0), contentType: "application/pdf" }])).toThrow(/no content/);
    expect(() => checkMailAttachments([{ filename: "x.pdf", content: "text", contentType: "application/pdf" }])).toThrow(/no content/);
    expect(() => checkMailAttachments(Array.from({ length: 6 }, () => ({ filename: "x.pdf", content: pdf(), contentType: "application/pdf" })))).toThrow(/At most 5/);
    expect(() => checkMailAttachments([{ filename: "x.pdf", content: pdf(10 * 1024 * 1024 + 1), contentType: "application/pdf" }])).toThrow(/10 MB/);
    const eight = { filename: "x.pdf", content: pdf(8 * 1024 * 1024), contentType: "application/pdf" };
    expect(() => checkMailAttachments([eight, eight])).toThrow(/15 MB/);
    expect(() => checkMailAttachments("nope")).toThrow(/list/);
  });
});
