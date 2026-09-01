import type { OptionalCategory } from "./config.js";

/**
 * Pure markup transforms shared by the `html.head`, `analytics.head`, and
 * `content.render` hooks. Kept dependency-free and side-effect-free so they can
 * be unit tested in isolation.
 */

const SCRIPT_OPEN_RE = /<script\b([^>]*)>/gi;
const IFRAME_RE = /<iframe\b[^>]*>(?:[\s\S]*?<\/iframe>)?/gi;

/** Rewrite every `<script>` opening tag in `html` so the browser will not run it
 * until the consent runtime unlocks the given category. */
export function gateScriptMarkup(html: string, category: OptionalCategory): string {
  return html.replace(SCRIPT_OPEN_RE, (_match, attrs: string) => {
    let rest = String(attrs)
      // Drop any existing type so ours is authoritative.
      .replace(/\stype\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      // Defer the network fetch too — a runtime-swapped src re-triggers it.
      .replace(/\ssrc\s*=/gi, " data-jf-src=")
      // Never keep a stale marker from a previous pass.
      .replace(/\sdata-jf-consent\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    rest = rest.trim();
    return `<script type="text/plain" data-jf-consent="${category}"${rest ? ` ${rest}` : ""}>`;
  });
}

/** Wrap an operator-supplied head snippet so it is gated behind `category`.
 * Snippets that already contain `<script>` tags are rewritten in place; a bare
 * snippet (inline JS, or a pixel) is wrapped in one gated script/container. */
export function gateSnippet(snippet: string, category: OptionalCategory): string {
  const trimmed = snippet.trim();
  if (!trimmed) return "";
  if (/<script\b/i.test(trimmed)) return gateScriptMarkup(trimmed, category);
  return `<script type="text/plain" data-jf-consent="${category}">${trimmed}</script>`;
}

function hostOf(url: string): string | null {
  const trimmed = url.trim();
  // Only absolute/protocol-relative URLs can be "off-site". A root- or
  // path-relative src is always same-origin — never gate it.
  if (!/^(https?:)?\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed, "https://placeholder.invalid").hostname.toLowerCase();
  } catch {
    return null;
  }
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[2] ?? match[3] ?? match[4] ?? "") : null;
}

/** Base64 so arbitrary embed markup survives a `data-` attribute untouched. */
export function encodeEmbed(html: string): string {
  return Buffer.from(html, "utf8").toString("base64");
}

/**
 * Replace off-site `<iframe>` embeds (YouTube, Maps, social oEmbeds, …) with a
 * placeholder the consent runtime restores once `marketing` is granted or the
 * visitor unlocks that one embed. Same-host iframes are left alone.
 */
export function gateEmbedsInHtml(
  html: string,
  siteHost: string,
  labels: { title: string; unlock: string },
): { html: string; gated: number } {
  let gated = 0;
  const site = siteHost.toLowerCase();
  const out = html.replace(IFRAME_RE, (match) => {
    const src = attr(match, "src");
    if (!src) return match;
    const host = hostOf(src);
    if (!host || host === site) return match;
    gated += 1;
    const encoded = encodeEmbed(match);
    const titleAttr = attr(match, "title") ?? "";
    const label = titleAttr ? `${labels.title}: ${titleAttr}` : labels.title;
    return (
      `<div class="jf-consent-embed" role="group" data-jf-consent-category="marketing"` +
      ` data-jf-consent-embed="${encoded}" data-jf-consent-host="${host}"` +
      ` data-jf-consent-embed-title="${escapeHtml(titleAttr)}">` +
      `<p class="jf-consent-embed__note">${escapeHtml(label)}</p>` +
      `<button type="button" class="jf-consent-embed__unlock">${escapeHtml(labels.unlock)}</button>` +
      `</div>`
    );
  });
  return { html: out, gated };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
