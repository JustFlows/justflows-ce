// SPDX-License-Identifier: MIT
import { coreBlocks, deviceVisibilityAttr, esc, sanitizeHref, safeHref, safeMediaSrc } from "@justflows/blocks";
import { queryPublishedContent } from "../content/content-query.js";
import { contentPermalinks } from "../navigation/permalinks-db.js";
import { getGeneralSettings } from "../settings/general-settings.js";
import { formatPhpDate } from "../i18n/datetime-format.js";
interface NavItem { label: string; url: string; target?: string; rel?: string; disableLink?: boolean; devices?: string[]; children?: NavItem[] }
export interface SiteBuildingContext {
  siteId: string; locale: string; homePath: string; path: string; query: string; title: string;
  identity: { siteTitle: string; tagline: string; logoUrl: string };
  primary: NavItem[]; footer: NavItem[];
  loadNavigation?: (slug: string) => Promise<NavItem[]>;
  renderNavigation?: (items: NavItem[], props: Record<string, unknown>, id: string) => Promise<string>;
}
const definitions = new Map(coreBlocks.map(block => [block.type, block]));
function safeMenuItems(items: NavItem[], depth = 0): NavItem[] {
  if (depth > 10) return [];
  return items.slice(0, 200).map(item => ({ ...item, url: sanitizeHref(item.url), ...(item.children ? { children: safeMenuItems(item.children, depth + 1) } : {}) }));
}
function navigation(items: NavItem[], submenus: boolean, depth = 0): string {
  if (depth > 10) return '';
  return `<ul>${items.slice(0, 200).map(item => `<li ${deviceVisibilityAttr(item.devices)}>${item.disableLink ? `<span>${esc(item.label)}</span>` : `<a href="${safeHref(item.url)}"${item.target === '_blank' ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(item.label)}</a>`}${submenus && item.children?.length ? navigation(item.children, true, depth + 1) : ''}</li>`).join('')}</ul>`;
}

export async function renderSiteBuildingBlocks(html: string, ctx: SiteBuildingContext): Promise<string> {
  const matches = Array.from(html.matchAll(/<!--jf-site:(core\.[a-z-]+):([^<>]*?)-->/g));
  if (!matches.length) return html;
  // Repeated instances share their data within this render, never between requests/sites.
  const queryResults = new Map<string, Promise<string>>();
  const menus = new Map<string, Promise<NavItem[]>>();
  let settings: ReturnType<typeof getGeneralSettings> | undefined;
  let output = '', previous = 0;
  for (const match of matches) {
    output += html.slice(previous, match.index);
    previous = match.index! + match[0].length;
    const type = match[1]!, def = definitions.get(type);
    let rendered = '';
    try {
      if (!def) continue;
      const p = def.validateProps(JSON.parse(decodeURIComponent(match[2]!)));
      if (type === 'core.site-logo' && ctx.identity.logoUrl) {
        const image = `<img src="${safeMediaSrc(ctx.identity.logoUrl)}" alt="${esc(String(p['alt']) || ctx.identity.siteTitle)}" width="${p['width']}" style="max-width:100%;height:auto">`;
        rendered = p['linkHome'] ? `<a href="${safeHref(ctx.homePath)}">${image}</a>` : image;
      } else if (type === 'core.site-title') {
        const title = esc(ctx.identity.siteTitle);
        rendered = `<h${p['level']}>${p['linkHome'] ? `<a href="${safeHref(ctx.homePath)}">${title}</a>` : title}</h${p['level']}>`;
      } else if (type === 'core.site-tagline') rendered = `<p>${esc(ctx.identity.tagline)}</p>`;
      else if (type === 'core.navigation') {
        const slug = String(p['menuSlug']);
        let items = p['source'] === 'footer' ? ctx.footer : ctx.primary;
        if (slug && ctx.loadNavigation) {
          if (!menus.has(slug)) menus.set(slug, ctx.loadNavigation(slug));
          items = await menus.get(slug)!;
        }
        items = safeMenuItems(items);
        if (ctx.renderNavigation) {
          if (!p['showSubmenus']) items = items.map(item => ({ ...item, children: [], megaMenu: undefined }));
          const list = await ctx.renderNavigation(items, p, `jf-core-nav-${match.index}`);
          rendered = `<nav class="jf-navigation" aria-label="${esc(String(p['label']))}" style="--jf-nav-direction:${p['direction']};--jf-nav-gap:${p['gap']}px">${list}</nav>`;
          output += rendered; continue;
        }
        const list = navigation(items, Boolean(p['showSubmenus']));
        rendered = `<nav class="jf-navigation${p['mobileCollapse'] ? ' jf-navigation--collapse' : ''}" aria-label="${esc(String(p['label']))}" style="--jf-nav-direction:${p['direction']};--jf-nav-gap:${p['gap']}px">${p['mobileCollapse'] ? `<details><summary>${esc(String(p['menuLabel']))}</summary>${list}</details><div class="jf-navigation-desktop">${list}</div>` : list}</nav>`;
      } else if (type === 'core.breadcrumbs') {
        rendered = `<nav aria-label="${esc(String(p['label']))}" class="jf-breadcrumbs"><ol><li><a href="${safeHref(ctx.homePath)}">${esc(String(p['homeLabel']))}</a></li>${p['showCurrent'] && ctx.path !== ctx.homePath && ctx.path !== '/' ? `<li><span aria-hidden="true">${esc(String(p['separator']))}</span> <span aria-current="page">${esc(ctx.title)}</span></li>` : ''}</ol></nav>`;
      } else if (type === 'core.content-query' && ctx.siteId) {
        const key = JSON.stringify(p);
        let result = queryResults.get(key);
        if (!result) {
          result = (async () => {
            const pageParams = new URLSearchParams(ctx.query);
            const pageKey = String(p['pageKey']);
            const page = p['pagination'] ? Math.min(100, Math.max(1, Math.trunc(Number(pageParams.get(pageKey))) || 1)) : 1;
            const limit = Number(p['limit']), baseOffset = Number(p['offset']);
            const offset = Math.min(10000, baseOffset + (page - 1) * limit);
            const data = await queryPublishedContent(ctx.siteId, ctx.locale, { contentType: String(p['contentType']), taxonomy: String(p['taxonomy']), term: String(p['term']), orderBy: String(p['orderBy']), order: String(p['order']), limit, offset });
            const urls = await contentPermalinks(data.items);
            settings ??= getGeneralSettings(ctx.siteId); const general = await settings;
            const itemHtml = data.items.map((item, i) => {
              const image = p['showImage'] ? safeMediaSrc(typeof item.fields['seoImage'] === 'string' ? item.fields['seoImage'] : typeof item.fields['featuredImage'] === 'string' ? item.fields['featuredImage'] : '') : '';
              const date = item.publishedAt ? new Date(item.publishedAt) : null;
              return `<article>${image ? `<img src="${image}" alt="" loading="lazy">` : ''}<h${p['titleLevel']}><a href="${safeHref(urls[i]!)}">${esc(item.title)}</a></h${p['titleLevel']}>${p['showDate'] && date && Number.isFinite(date.getTime()) ? `<time datetime="${date.toISOString()}">${esc(formatPhpDate(date, general.dateFormat, { timeZone: general.timezone }))}</time>` : ''}${p['showExcerpt'] && item.excerpt ? `<p>${esc(item.excerpt)}</p>` : ''}</article>`;
            }).join('');
            const pageLink = (target: number, label: unknown) => { const params = new URLSearchParams(ctx.query); params.set(pageKey, String(target)); return `<a href="${safeHref(ctx.path + '?' + params.toString())}">${esc(String(label))}</a>`; };
            return `<div class="jf-content-query jf-content-query--${p['layout']}" style="--jf-query-columns:${p['columns']}">${itemHtml || `<p>${esc(String(p['emptyLabel']))}</p>`}</div>${p['pagination'] && (page > 1 || offset + limit < data.total) ? `<nav class="jf-query-pagination" aria-label="Pagination">${page > 1 ? pageLink(page - 1, p['previousLabel']) : ''}${offset + limit < data.total && page < 100 && offset < 10000 ? pageLink(page + 1, p['nextLabel']) : ''}</nav>` : ''}`;
          })(); queryResults.set(key, result);
        }
        rendered = await result;
      }
    } catch { rendered = type === 'core.content-query' ? '<p role="status">Content is temporarily unavailable.</p>' : ''; }
    output += rendered;
  }
  return output + html.slice(previous);
}
