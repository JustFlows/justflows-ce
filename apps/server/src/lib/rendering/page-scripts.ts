// SPDX-License-Identifier: MIT

import fs from "node:fs";
import path from "node:path";
import { getJfRoot } from "../runtime/jf-root.js";

/**
 * Core public scripts (`public/js`, compiled from
 * `apps/server/public-scripts/src`): their content-hashed URLs, and which ones
 * a rendered page actually needs.
 */

/** `/js/<name>-<hash>.js` (or its map), as written by `public-scripts/build.mjs`. */
export const HASHED_PUBLIC_SCRIPT = /^\/js\/([a-z0-9-]+)-[A-Z0-9]{8}\.js(\.map)?$/;

const NAME_RE = /^[a-z0-9-]+$/;
const MANIFEST_RECHECK_MS = 2_000;

let manifest: { checkedAt: number; mtimeMs: number; urls: Record<string, string> } | null = null;

function manifestPath(): string {
  return path.join(getJfRoot(), "public", "js", "manifest.json");
}

/**
 * The build's name → hashed URL map. Re-stat at most every couple of seconds
 * so a rebuild (or a watch run, which removes the manifest) is picked up
 * without a restart.
 */
function manifestUrls(): Record<string, string> {
  const now = Date.now();
  if (manifest && now - manifest.checkedAt < MANIFEST_RECHECK_MS) return manifest.urls;
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(manifestPath()).mtimeMs;
  } catch {
    /** No manifest: a watch build or a checkout that was never built. */
  }
  if (manifest && manifest.mtimeMs === mtimeMs) {
    manifest.checkedAt = now;
    return manifest.urls;
  }
  const urls: Record<string, string> = {};
  if (mtimeMs >= 0) {
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath(), "utf8")) as Record<string, unknown>;
      for (const [name, url] of Object.entries(raw)) {
        if (NAME_RE.test(name) && typeof url === "string" && HASHED_PUBLIC_SCRIPT.exec(url)?.[1] === name) {
          urls[name] = url;
        }
      }
    } catch {
      /** A half-written manifest falls back to the stable URLs until the next check. */
    }
  }
  manifest = { checkedAt: now, mtimeMs, urls };
  return urls;
}

/** The URL to link for a core public script: hashed when built, else `/js/<name>.js`. */
export function publicScriptUrl(name: string): string {
  return manifestUrls()[name] ?? `/js/${name}.js`;
}

/** Drop the memoized manifest (tests). */
export function resetPublicScriptManifest(): void {
  manifest = null;
}

/** Where `layout.ejs` puts the scripts this module picks for the page. */
export const HEAD_SCRIPTS_SLOT = "<!--jf:head-scripts-->";
export const BODY_SCRIPTS_SLOT = "<!--jf:body-scripts-->";

interface PageScript {
  name: string;
  slot: "head" | "body";
  /** Markup that needs the script. Omitted: every page loads it. */
  needs?: RegExp;
  /** Leave off `defer`. */
  blocking?: true;
}

/**
 * Each script is matched against the finished page, so markup from any source
 * (content, header and footer parts, widgets, plugin blocks, cached fragments)
 * counts, and a page that has none of a script's markup does not load it.
 */
const PAGE_SCRIPTS: readonly PageScript[] = [
  /**
   * Applies the visitor's stored colour scheme to `<html>` before first paint,
   * on every page, so a dark-mode visitor never sees a light flash. This is the
   * one blocking script; the CSP forbids doing it inline.
   */
  { name: "site-chrome", slot: "head", blocking: true },
  { name: "site-nav", slot: "head", needs: /data-jf-nav|\bjf-nav__/ },
  { name: "site-toast", slot: "head", needs: /\bdata-jf-toast[\s=>]/ },
  /** Rewrites sign-in and register links for a signed-in visitor. */
  { name: "site-session", slot: "head", needs: /\bhref=["'][^"']*\/(?:login|register)\/?(?:[?#][^"']*)?["']/ },
  { name: "block-animations", slot: "body", needs: /\bdata-jf-anim=["']in-view["']/ },
  {
    name: "block-interactions",
    slot: "body",
    needs: /\bdata-jf-exclusive=["']true["']|\bjf-(?:tabs|toc)\b|\bdata-jf-(?:dismiss|cover-toggle)\b/,
  },
];

interface PageStylesheet {
  href: string;
  needs: RegExp;
}

/** Core stylesheets only some pages need, matched against the finished page like the scripts. */
const PAGE_STYLESHEETS: readonly PageStylesheet[] = [
  /** KaTeX's styles and fonts, for the `jf-math` formulas `renderMath` in @justflows/blocks renders. */
  { href: "/vendor/katex/katex.min.css", needs: /\bclass=["']jf-math\b/ },
];

/** Core stylesheet URLs `html` needs. */
export function pageStylesheetHrefs(html: string): string[] {
  return PAGE_STYLESHEETS.filter((sheet) => sheet.needs.test(html)).map((sheet) => sheet.href);
}

/** Core script names `html` needs, in load order. */
export function pageScriptNames(html: string): string[] {
  return PAGE_SCRIPTS.filter((script) => !script.needs || script.needs.test(html)).map((script) => script.name);
}

function scriptTag(script: PageScript): string {
  return `<script src="${publicScriptUrl(script.name)}"${script.blocking ? "" : " defer"}></script>`;
}

/**
 * Fill the layout's script slots with the core stylesheets and scripts the
 * finished page needs, followed by `extra` tags (theme and per-block plugin
 * assets) in each slot.
 */
export function applyPageScripts(html: string, extra: { head?: string[]; body?: string[] } = {}): string {
  const needed = new Set(pageScriptNames(html));
  const tags = (slot: "head" | "body") => [
    ...(slot === "head" ? pageStylesheetHrefs(html).map((href) => `<link rel="stylesheet" href="${href}">`) : []),
    ...PAGE_SCRIPTS.filter((script) => script.slot === slot && needed.has(script.name)).map(scriptTag),
    ...(extra[slot] ?? []),
  ].join("\n");
  let out = html;
  const head = out.indexOf(HEAD_SCRIPTS_SLOT);
  if (head !== -1) out = `${out.slice(0, head)}${tags("head")}${out.slice(head + HEAD_SCRIPTS_SLOT.length)}`;
  const body = out.lastIndexOf(BODY_SCRIPTS_SLOT);
  if (body !== -1) out = `${out.slice(0, body)}${tags("body")}${out.slice(body + BODY_SCRIPTS_SLOT.length)}`;
  return out;
}
