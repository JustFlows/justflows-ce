import { describe, expect, it } from "vitest";
import { contentMatchesMimeType } from "../file-type.js";

const pad = (head: number[]) => Buffer.concat([Buffer.from(head), Buffer.alloc(16)]);
const png = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = pad([0xff, 0xd8, 0xff, 0xe0]);
const gif = pad([...Buffer.from("GIF89a")]);
const pdf = pad([...Buffer.from("%PDF-1.7")]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)]);
const html = Buffer.from("<html><script>alert(1)</script></html>");

describe("contentMatchesMimeType", () => {
  it("accepts real files under their true type", () => {
    expect(contentMatchesMimeType(png, "image/png")).toBe(true);
    expect(contentMatchesMimeType(jpeg, "image/jpeg")).toBe(true);
    expect(contentMatchesMimeType(gif, "image/gif")).toBe(true);
    expect(contentMatchesMimeType(pdf, "application/pdf")).toBe(true);
    expect(contentMatchesMimeType(webp, "image/webp")).toBe(true);
  });

  it("rejects HTML smuggled in under an image type", () => {
    // multer takes file.mimetype from the client's own Content-Type part header.
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(contentMatchesMimeType(html, type), type).toBe(false);
    }
  });

  it("rejects a real file declared as the wrong type", () => {
    expect(contentMatchesMimeType(png, "image/jpeg")).toBe(false);
    expect(contentMatchesMimeType(pdf, "image/png")).toBe(false);
  });

  it("rejects an unknown type outright", () => {
    expect(contentMatchesMimeType(png, "image/svg+xml")).toBe(false);
    expect(contentMatchesMimeType(png, "text/html")).toBe(false);
  });

  it("rejects a buffer too short to identify", () => {
    expect(contentMatchesMimeType(Buffer.from([0x89, 0x50]), "image/png")).toBe(false);
  });
});
