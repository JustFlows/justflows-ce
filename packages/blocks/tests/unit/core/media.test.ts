// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { coreBlocks } from "../../../src/core/index.js";
import { BlockRegistry } from "../../../src/registry/block-registry.js";
import { sanitizeBlockDocument } from "../../../src/sanitize-document.js";

const registry = new BlockRegistry();
coreBlocks.forEach((block) => registry.register(block));
const render = (type: string, props: Record<string, unknown>) => registry.renderNode({ type, props });

describe("media blocks", () => {
  it("registers each block in the media library with safe defaults", () => {
    for (const type of ["core.video", "core.audio", "core.file"]) {
      expect(registry.get(type)?.category).toBe("media");
      expect(() => registry.get(type)!.validateProps(null)).not.toThrow();
    }
    expect(render("core.video", { src: "/movie.mp4" })).toContain('controls playsinline');
    expect(render("core.audio", { src: "/sound.mp3" })).toContain('preload="metadata" controls');
    expect(render("core.video", {})).not.toContain('src=""');
  });

  it("renders configurable video playback, poster, fit and bounded sizing", () => {
    const html = render("core.video", { src: "https://example.com/movie.mp4?a=1&b=2", poster: "/poster.jpg", controls: false, autoplay: true, muted: true, loop: true, playsInline: true, preload: "auto", width: 50000, height: -5, objectFit: "cover", caption: "<script>bad</script>" });
    expect(html).toContain('src="https://example.com/movie.mp4?a=1&amp;b=2"');
    expect(html).toContain('autoplay muted loop playsinline');
    expect(html).not.toContain(' controls');
    expect(html).toContain('poster="/poster.jpg"');
    expect(html).toContain('width="10000"');
    expect(html).not.toContain('height="-5"');
    expect(html).toContain('object-fit:cover');
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
  });

  it("rejects unsafe URLs, malformed flags and injected enum values", () => {
    for (const type of ["core.video", "core.audio", "core.file"]) {
      const html = render(type, { src: "javascript:alert(1)", poster: "data:text/html,evil", controls: "false", autoplay: "true", preload: '\" onerror=evil', objectFit: "cover;position:fixed" });
      expect(html).not.toMatch(/javascript:|data:|onerror|position:fixed| autoplay/);
      expect(html).not.toContain('href="#"');
    }
    expect(render("core.video", {})).toContain('object-fit:contain');
  });

  it("renders audio and optional file downloads with escaped labels", () => {
    expect(render("core.audio", { src: "/sound.mp3", loop: true, muted: true })).toContain('controls muted loop');
    expect(render("core.file", { src: "/report.pdf", label: '<Report>' })).toContain('<a href="/report.pdf" download>&lt;Report&gt;</a>');
    expect(render("core.file", { src: "/report.pdf?token=abc", download: false })).toContain('>report.pdf</a>');
    expect(render("core.file", { src: "/report.pdf", download: false })).not.toContain(' download');
  });

  it("sanitizes stored media URLs while preserving playback settings", () => {
    const doc = sanitizeBlockDocument({ blocks: [
      { id: "v", type: "core.video", props: { src: "javascript:evil", poster: "data:evil", muted: true, preload: "auto" } },
      { id: "a", type: "core.audio", props: { src: "javascript:evil" } },
      { id: "f", type: "core.file", props: { src: "javascript:evil" } },
    ] });
    expect(doc.blocks[0]).toMatchObject({ props: { src: "", poster: "", muted: true, preload: "auto" } });
    expect(doc.blocks[1]).toMatchObject({ props: { src: "" } });
    expect(doc.blocks[2]).toMatchObject({ props: { src: "" } });
  });
});
