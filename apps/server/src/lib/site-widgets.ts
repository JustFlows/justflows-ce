// SPDX-License-Identifier: MIT

import { esc } from "@justflows/blocks";

export interface SiteLanguageLink {
  code: string;
  name: string;
  href: string;
  current: boolean;
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
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(html);
  return match?.[1] ?? "";
}

function languageInner(links: SiteLanguageLink[], style: string): string {
  if (links.length < 2) return "";
  return links
    .map((lang) => {
      const label = style === "names" ? lang.name || lang.code : lang.code.toUpperCase();
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

  let out = html.replace(
    /<nav([^>]*\bdata-jf-widget="language-switcher"[^>]*)><!--jf:language-switcher--><\/nav>/g,
    (_all, attrs: string) => {
      const style = attr(attrs, "data-jf-style") || "codes";
      const inner = languageInner(ctx.languageLinks, style);
      if (!inner) return "";
      const labelled = /\baria-label=/.test(attrs)
        ? attrs
        : `${attrs} aria-label="${esc(ctx.labels.language)}"`;
      return `<nav${labelled}>${inner}</nav>`;
    },
  );

  out = out.replace(
    /<nav([^>]*\bdata-jf-widget="auth-links"[^>]*)><!--jf:auth-links--><\/nav>/g,
    (_all, attrs: string) => {
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
