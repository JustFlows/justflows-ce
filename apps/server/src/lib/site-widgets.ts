// SPDX-License-Identifier: MIT

import { esc } from "@justflows/blocks";

export interface SiteLanguageLink {
  code: string;
  name: string;
  href: string;
  current: boolean;
  displayCode?: string;
}

export interface SiteWidgetContext {
  languageLinks: SiteLanguageLink[];
  usersCanRegister: boolean;
  labels: {
    login: string;
    register: string;
    language: string;
  };
}

function attr(html: string, name: string): string {
  for (const quote of ['"', "'"]) {
    const needle = `${name}=${quote}`;
    const start = html.indexOf(needle);
    if (start < 0) continue;
    const valueStart = start + needle.length;
    const end = html.indexOf(quote, valueStart);
    if (end >= 0) return html.slice(valueStart, end);
  }
  return "";
}

function replaceWidget(
  html: string,
  type: string,
  marker: string,
  render: (attrs: string) => string,
): string {
  let out = "";
  let cursor = 0;
  while (cursor < html.length) {
    const markerAt = html.indexOf(marker, cursor);
    if (markerAt < 0) return out + html.slice(cursor);
    const navStart = html.lastIndexOf("<nav", markerAt);
    const openEnd = navStart >= cursor ? html.indexOf(">", navStart + 4) : -1;
    const closeEnd = markerAt + marker.length;
    if (navStart < cursor || openEnd + 1 !== markerAt || html.slice(closeEnd, closeEnd + 6) !== "</nav>") {
      out += html.slice(cursor, closeEnd);
      cursor = closeEnd;
      continue;
    }
    const attrs = html.slice(navStart + 4, openEnd);
    if (attr(attrs, "data-jf-widget") !== type) {
      out += html.slice(cursor, closeEnd);
      cursor = closeEnd;
      continue;
    }
    out += html.slice(cursor, navStart) + render(attrs);
    cursor = closeEnd + 6;
  }
  return out;
}

function languageInner(links: SiteLanguageLink[], style: string): string {
  if (links.length < 2) return "";
  return links
    .map((lang) => {
      const label = style === "names" ? lang.name || lang.code : lang.displayCode || lang.code.toUpperCase();
      const current = lang.current ? " is-current" : "";
      const aria = lang.current ? ` aria-current="page"` : "";
      return `<a href="${esc(lang.href)}" class="jf-language-switcher__link${current}"${aria}>${esc(label)}</a>`;
    })
    .join("");
}

function authInner(
  showLogin: boolean,
  showRegister: boolean,
  loginLabel: string,
  registerLabel: string,
  style: string,
  usersCanRegister: boolean,
): string {
  const parts: string[] = [];
  const btn = style === "links" ? "" : " btn";
  const loginClass = style === "links" ? "jf-auth-links__link" : "btn btn--outline jf-auth-links__login";
  const registerClass = style === "links" ? "jf-auth-links__link jf-auth-links__register" : "btn btn--primary jf-auth-links__register";
  if (showLogin) {
    parts.push(`<a href="/login" class="${loginClass}${btn && style !== "links" ? "" : ""}">${esc(loginLabel)}</a>`);
  }
  if (showRegister && usersCanRegister) {
    parts.push(`<a href="/register" class="${registerClass}">${esc(registerLabel)}</a>`);
  }
  void btn;
  return parts.join("");
}

/** Fill language and auth placeholders with request-time site data. */
export function hydrateSiteWidgets(html: string, ctx: SiteWidgetContext): string {
  if (!html.includes("data-jf-widget=")) return html;

  let out = replaceWidget(
    html,
    "language-switcher",
    "<!--jf:language-switcher-->",
    (attrs) => {
      const style = attr(attrs, "data-jf-style") || "codes";
      const inner = languageInner(ctx.languageLinks, style);
      if (!inner) return "";
      const labelled = attr(attrs, "aria-label")
        ? attrs
        : `${attrs} aria-label="${esc(ctx.labels.language)}"`;
      return `<nav${labelled}>${inner}</nav>`;
    },
  );

  out = replaceWidget(
    out,
    "auth-links",
    "<!--jf:auth-links-->",
    (attrs) => {
      const style = attr(attrs, "data-jf-style") || "buttons";
      const showLogin = attr(attrs, "data-jf-show-login") !== "0";
      const showRegister = attr(attrs, "data-jf-show-register") !== "0";
      const loginLabel = attr(attrs, "data-jf-login-label") || ctx.labels.login;
      const registerLabel = attr(attrs, "data-jf-register-label") || ctx.labels.register;
      const inner = authInner(showLogin, showRegister, loginLabel, registerLabel, style, ctx.usersCanRegister);
      if (!inner) return "";
      return `<nav${attrs}>${inner}</nav>`;
    },
  );

  return out;
}
