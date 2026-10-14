// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { createBlockRegistrySync, sanitizeBlockDocument } from "../../../src/index.js";
const registry = createBlockRegistrySync();
const render = (type: string, props: Record<string, unknown> = {}, children?: Array<{ type: string; props: Record<string, unknown> }>) => registry.renderNode({ type: `core.${type}`, props, ...(children ? { children } : {}) });
const child = { type: "core.paragraph", props: { text: "Child content" } };
describe("functional core blocks", () => {
  it("renders nested numbered/check lists with safe rich text and checked items", () => {
    const html = render("list", { listStyle: "numbered", start: 5, reversed: true }, [{ type: 'core.list-item', props: { text: '<b>First</b><script>bad()</script>', checked: true } }]);
    expect(html).toContain('<ol'); expect(html).toContain('start="5" reversed'); expect(html).toContain(' checked'); expect(html).not.toContain('script');
    expect(render('list', { listStyle: 'checklist' })).toContain('jf-list--checklist');
  });
  it("renders semantic table headers, footer, escaped cells, and normalized rows", () => {
    const html = render('table', { caption: 'Prices', rows: [['<Title>', 'Cost'], ['Item'], ['Total', '20']], header: true, footer: true });
    expect(html).toContain('<caption>Prices</caption>'); expect(html).toContain('<th scope="col">&lt;Title&gt;</th>');
    expect(html).toContain('<td>Item</td><td></td>'); expect(html).toContain('<tfoot>');
  });
  it("supports child content in every composition block", () => {
    for (const type of ['details', 'accordion', 'cover', 'media-text', 'buttons', 'card', 'callout', 'tabs', 'tab']) {
      expect(registry.get(`core.${type}`)?.supportsChildren).toBe(true);
      expect(render(type, {}, [child])).toContain('Child content');
    }
    expect(registry.get('core.tabs')?.allowedChildTypes).toEqual(['core.tab']);
  });
  it("bounds numeric settings and rejects URL, colour and CSS injection", () => {
    const html = render('cover', { mediaType: 'video', src: 'javascript:evil', poster: 'data:evil', overlayColor: 'red;position:fixed', minHeight: 90000, align: 'left;position:fixed', overlayOpacity: 900 });
    expect(html).not.toMatch(/javascript:|data:evil|position:fixed/); expect(html).toContain('min-height:2000px'); expect(html).toContain('opacity:1');
    expect(render('icon', { name: '<svg onload=evil>', color: 'red;evil', size: 1000 })).toContain('width="256"');
    expect(render('details', { summary: '<script>evil</script>' })).toContain('&lt;script&gt;');
  });
  it("gives video covers a working pause control and keeps media/text video controls", () => {
    expect(render('cover', { mediaType: 'video', src: '/movie.mp4', pauseLabel: 'Pause clip' })).toContain('data-jf-cover-toggle');
    expect(render('cover', { mediaType: 'video', src: '/movie.mp4', pauseLabel: 'Pause clip' })).toContain('aria-label="Pause clip"');
    expect(render('media-text', { mediaType: 'video', src: '/movie.mp4', mediaSide: 'right' })).toContain('controls playsinline');
  });
  it("sanitizes stored composition media and list-item content", () => {
    const doc = sanitizeBlockDocument({ blocks: [{ type: 'core.cover', props: { src: 'javascript:evil', poster: 'data:evil' } }, { type: 'core.list-item', props: { text: '<script>evil()</script>Hi' } }] });
    expect(doc.blocks[0]).toMatchObject({ props: { src: '', poster: '' } }); expect(doc.blocks[1]).toMatchObject({ props: { text: 'Hi' } });
  });
  it("renders configurable social profiles and safe dynamic placeholders", () => {
    const html = render('social-links', { links: [{ label: '<GitHub>', icon: 'github', url: 'https://github.com/test' }, { label: 'Bad', url: 'javascript:evil' }], showLabels: false });
    expect(html).toContain('aria-label="&lt;GitHub&gt;"'); expect(html).toContain('rel="noopener noreferrer"'); expect(html).not.toContain('javascript:'); expect(html).not.toContain('>Bad');
    expect(render('site-title', { level: 100 })).toContain('jf-site:core.site-title:');
    expect(registry.get('core.content-query')!.validateProps({ limit: 10000, orderBy: 'title;DROP', pageKey: 'evil' })).toMatchObject({ limit: 100, orderBy: 'published', pageKey: 'content-page' });
  });
});

it('keeps useful content blocks available in post editors', () => {
  for (const type of ['core.social-links', 'core.table-of-contents', 'core.content-query']) expect(registry.get(type)?.category).toBe('content');
});
