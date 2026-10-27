// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBlockRegistrySync } from "@justflows/blocks";
const mocks = vi.hoisted(() => ({ query: vi.fn(), urls: vi.fn(), settings: vi.fn() }));
vi.mock('../../../src/lib/content/content-query.js', () => ({ queryPublishedContent: mocks.query }));
vi.mock('../../../src/lib/navigation/permalinks-db.js', () => ({ contentPermalinks: mocks.urls }));
vi.mock('../../../src/lib/settings/general-settings.js', () => ({ getGeneralSettings: mocks.settings }));
import { renderSiteBuildingBlocks, type SiteBuildingContext } from '../../../src/lib/rendering/site-building-blocks.js';
const registry = createBlockRegistrySync();
const block = (type: string, props: Record<string, unknown> = {}) => registry.renderNode({ type: `core.${type}`, props });
const ctx: SiteBuildingContext = { siteId: 'site-one', locale: 'nl', homePath: '/nl/', path: '/nl/news', query: '', title: '<News>', identity: { siteTitle: '<Site>', tagline: 'A & B', logoUrl: '/logo.png' }, primary: [{ label: 'Home', url: '/nl/', children: [{ label: '<Child>', url: 'javascript:evil' }] }], footer: [] };
beforeEach(() => {
  vi.clearAllMocks(); mocks.query.mockResolvedValue({ items: [{ id: 'one', title: '<Post>', excerpt: '<Excerpt>', publishedAt: '2026-01-01', fields: { seoImage: '/image.png' } }], total: 20 });
  mocks.urls.mockResolvedValue(['/nl/post']); mocks.settings.mockResolvedValue({ dateFormat: 'Y-m-d', timezone: 'UTC' });
});
describe('site-building render context', () => {
  it('hydrates identity from this request with escaped text and a localized homepage', async () => {
    const html = await renderSiteBuildingBlocks(block('site-title', { level: 3 }) + block('site-tagline') + block('site-logo'), ctx);
    expect(html).toContain('<h3><a href="/nl/">&lt;Site&gt;</a></h3>'); expect(html).toContain('A &amp; B'); expect(html).toContain('src="/logo.png"');
  });
  it('renders resolved menus and accessible current-page breadcrumbs', async () => {
    const html = await renderSiteBuildingBlocks(block('navigation') + block('breadcrumbs', { separator: '>' }), ctx);
    expect(html).toContain('&lt;Child&gt;'); expect(html).not.toContain('javascript:evil');
    expect(html).toContain('aria-current="page">&lt;News&gt;'); expect(html).toContain('&gt;');
  });
  it('loads a custom menu once per render through the request-aware loader', async () => {
    const load = vi.fn(async () => [{ label: 'Custom', url: '/custom' }]);
    const html = await renderSiteBuildingBlocks(block('navigation', { menuSlug: 'custom' }).repeat(2), { ...ctx, loadNavigation: load });
    expect(load).toHaveBeenCalledTimes(1); expect(html).toContain('>Custom</a>');
  });
  it('paginates and filters queries within the site and locale, with bounded shared data reads', async () => {
    const node = block('content-query', { contentType: 'post', taxonomy: 'category', term: 'updates', limit: 5 });
    const html = await renderSiteBuildingBlocks(node.repeat(2), { ...ctx, query: 'content-page=2&campaign=one' });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledWith('site-one', 'nl', expect.objectContaining({ contentType: 'post', taxonomy: 'category', term: 'updates', limit: 5, offset: 5 }));
    expect(mocks.urls).toHaveBeenCalledTimes(1); expect(mocks.settings).toHaveBeenCalledTimes(1);
    expect(html).toContain('href="/nl/post"'); expect(html).toContain('&lt;Post&gt;'); expect(html).toContain('&lt;Excerpt&gt;');
    expect(html).toContain('content-page=3&amp;campaign=one');
  });
  it('uses configured empty states and does not leak failures', async () => {
    mocks.query.mockResolvedValueOnce({ items: [], total: 0 });
    expect(await renderSiteBuildingBlocks(block('content-query', { emptyLabel: '<Empty>' }), ctx)).toContain('&lt;Empty&gt;');
    mocks.query.mockRejectedValueOnce(new Error('/secret/path'));
    const html = await renderSiteBuildingBlocks(block('content-query'), ctx);
    expect(html).toContain('temporarily unavailable'); expect(html).not.toContain('/secret/path');
  });
});

it('reuses the existing menu renderer with unique instance IDs and sanitized URLs', async () => {
  const render = vi.fn(async (_items: unknown, _props: unknown, _id: string) => '<ul class="jf-nav"><li>Existing menu</li></ul>');
  const html = await renderSiteBuildingBlocks(block('navigation').repeat(2), { ...ctx, renderNavigation: render });
  expect(render).toHaveBeenCalledTimes(2);
  expect(render.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ children: [expect.objectContaining({ url: '#' })] })]));
  expect(render.mock.calls[0]?.[2]).not.toBe(render.mock.calls[1]?.[2]);
  expect(html).toContain('Existing menu');
});
