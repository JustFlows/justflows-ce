// SPDX-License-Identifier: MIT

import type { BlockDefinition } from "../registry/block-registry.js";
import { esc } from "../safe-url.js";

function str(raw: unknown, fallback = ""): string {
  return typeof raw === "string" ? raw : fallback;
}

function bool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  return fallback;
}

function pick(raw: unknown, allowed: string[], fallback: string): string {
  const value = str(raw);
  return allowed.includes(value) ? value : fallback;
}

const ALIGN = ["left", "center", "right"] as const;
const COLOR_SCHEME_STYLES = [
  "buttons",
  "icons",
  "segmented",
  "toggle",
  "switch",
  "select",
  "labels",
  "tooltip-icons",
] as const;
const COLOR_SCHEME_SIZES = ["sm", "md", "lg"] as const;
const COLOR_SCHEME_RADII = ["pill", "rounded", "square"] as const;
const COLOR_SCHEME_ICONS = { light: "☀", dark: "☾", system: "◐" } as const;
const COLOR_SCHEME_LABELS = { light: "Light", dark: "Dark", system: "Auto" } as const;
const LANGUAGE_SWITCHER_STYLES = [
  "locale-full",
  "locale-short",
  "flags",
  "flag-locale",
  "flag-country",
  // Kept for blocks saved before the expanded selector styles.
  "codes",
  "names",
] as const;

function alignClass(align: string): string {
  return ` jf-site-widget jf-site-widget--${align}`;
}

export const siteWidgetBlocks: BlockDefinition[] = [
  {
    type: "core.color-scheme",
    version: 1,
    title: "Light / dark",
    description: "Lets visitors switch between light and dark appearance.",
    icon: "◐",
    category: "site",
    schema: {
      style: { type: "select", options: [...COLOR_SCHEME_STYLES], default: "buttons" },
      align: { type: "select", options: [...ALIGN], default: "right" },
      showSystem: { type: "boolean", default: false },
      animate: { type: "boolean", default: true },
      size: { type: "select", options: [...COLOR_SCHEME_SIZES], default: "md" },
      radius: { type: "select", options: [...COLOR_SCHEME_RADII], default: "pill" },
      lightIcon: { type: "text", default: COLOR_SCHEME_ICONS.light },
      darkIcon: { type: "text", default: COLOR_SCHEME_ICONS.dark },
      autoIcon: { type: "text", default: COLOR_SCHEME_ICONS.system },
      lightLabel: { type: "text", default: COLOR_SCHEME_LABELS.light },
      darkLabel: { type: "text", default: COLOR_SCHEME_LABELS.dark },
      autoLabel: { type: "text", default: COLOR_SCHEME_LABELS.system },
    },
    validateProps: (raw) => {
      const r = raw as Record<string, unknown>;
      return {
        style: pick(r["style"], [...COLOR_SCHEME_STYLES], "buttons"),
        align: pick(r["align"], [...ALIGN], "right"),
        showSystem: bool(r["showSystem"], false),
        animate: bool(r["animate"], true),
        size: pick(r["size"], [...COLOR_SCHEME_SIZES], "md"),
        radius: pick(r["radius"], [...COLOR_SCHEME_RADII], "pill"),
        lightIcon: str(r["lightIcon"], COLOR_SCHEME_ICONS.light) || COLOR_SCHEME_ICONS.light,
        darkIcon: str(r["darkIcon"], COLOR_SCHEME_ICONS.dark) || COLOR_SCHEME_ICONS.dark,
        autoIcon: str(r["autoIcon"], COLOR_SCHEME_ICONS.system) || COLOR_SCHEME_ICONS.system,
        lightLabel: str(r["lightLabel"], COLOR_SCHEME_LABELS.light) || COLOR_SCHEME_LABELS.light,
        darkLabel: str(r["darkLabel"], COLOR_SCHEME_LABELS.dark) || COLOR_SCHEME_LABELS.dark,
        autoLabel: str(r["autoLabel"], COLOR_SCHEME_LABELS.system) || COLOR_SCHEME_LABELS.system,
      };
    },
    render: (props) => {
      const p = props as {
        style: string;
        align: string;
        showSystem: boolean;
        animate: boolean;
        size: string;
        radius: string;
        lightIcon: string;
        darkIcon: string;
        autoIcon: string;
        lightLabel: string;
        darkLabel: string;
        autoLabel: string;
      };
      const { style, align, showSystem, animate, size, radius } = p;
      // Every variant leans on the existing preference engine in
      // /js/site-chrome.js: button variants carry data-jf-theme, the
      // single control carries data-jf-theme="toggle", and the compact
      // variant is a <select data-jf-color-scheme-select>. No variant
      // ships its own theme-state logic. Author-supplied icons and labels
      // are escaped for both attribute and text context.
      const modes: Array<[string, string, string]> = [
        ["light", esc(p.lightIcon), esc(p.lightLabel)],
        ["dark", esc(p.darkIcon), esc(p.darkLabel)],
      ];
      if (showSystem) modes.push(["system", esc(p.autoIcon), esc(p.autoLabel)]);

      const open = `<div class="jf-color-scheme jf-color-scheme--${esc(style)} jf-color-scheme--size-${esc(
        size,
      )} jf-color-scheme--radius-${esc(radius)}${
        animate ? " is-animated" : ""
      }${alignClass(align)}" data-jf-widget="color-scheme" data-jf-style="${esc(style)}">`;
      const close = `</div>`;

      if (style === "select") {
        const options = modes
          .map(([mode, , label]) => `    <option value="${mode}">${label}</option>`)
          .join("\n");
        return `${open}
  <select class="jf-color-scheme__select" data-jf-color-scheme-select aria-label="Appearance">
${options}
  </select>
${close}`;
      }

      // Both single-control variants flip between light and dark through
      // data-jf-theme="toggle"; site-chrome.js resolves it against the current
      // theme and reflects state back as aria-pressed / aria-checked.
      if (style === "switch") {
        // A real switch: a track with a sliding thumb, no button chrome.
        return `${open}
  <button type="button" class="jf-color-scheme__btn jf-color-scheme__switch" data-jf-theme="toggle" role="switch" aria-checked="false" aria-label="${esc(
    p.darkLabel,
  )}" title="${esc(p.darkLabel)}">
    <span class="jf-color-scheme__label">${esc(p.darkLabel)}</span>
    <span class="jf-color-scheme__track" aria-hidden="true"><span class="jf-color-scheme__thumb"></span></span>
  </button>
${close}`;
      }

      if (style === "toggle") {
        return `${open}
  <button type="button" class="jf-color-scheme__btn jf-color-scheme__toggle" data-jf-theme="toggle" aria-pressed="false" aria-label="${esc(
    p.darkLabel,
  )}" title="${esc(p.darkLabel)}">
    <span class="jf-color-scheme__icon jf-color-scheme__icon--sun" aria-hidden="true">${esc(p.lightIcon)}</span>
    <span class="jf-color-scheme__icon jf-color-scheme__icon--moon" aria-hidden="true">${esc(p.darkIcon)}</span>
    <span class="jf-color-scheme__label">${esc(p.darkLabel)}</span>
  </button>
${close}`;
      }

      const tooltip = style === "tooltip-icons";
      const button = ([mode, icon, label]: [string, string, string]) =>
        `  <button type="button" class="jf-color-scheme__btn" data-jf-theme="${mode}" aria-pressed="false" aria-label="${label}"${
          tooltip ? ` title="${label}"` : ""
        }>
    <span class="jf-color-scheme__icon" aria-hidden="true">${icon}</span>
    <span class="jf-color-scheme__label">${label}</span>
  </button>`;
      return `${open}
${modes.map(button).join("\n")}
${close}`;
    },
  },
  {
    type: "core.language-switcher",
    version: 1,
    title: "Language switcher",
    description: "Shows links to the other languages this site is published in.",
    icon: "文",
    category: "site",
    schema: {
      style: { type: "select", options: [...LANGUAGE_SWITCHER_STYLES], default: "locale-short" },
      align: { type: "select", options: [...ALIGN], default: "right" },
    },
    validateProps: (raw) => {
      const r = raw as Record<string, unknown>;
      return {
        style: pick(r["style"], [...LANGUAGE_SWITCHER_STYLES], "locale-short"),
        align: pick(r["align"], [...ALIGN], "right"),
      };
    },
    render: (props) => {
      const { style, align } = props as { style: string; align: string };
      return `<nav class="jf-language-switcher jf-language-switcher--${esc(style)}${alignClass(align)}" data-jf-widget="language-switcher" data-jf-style="${esc(style)}" aria-label="Language"><!--jf:language-switcher--></nav>`;
    },
  },
  {
    type: "core.auth-links",
    version: 1,
    title: "Login / Register",
    description: "Login and register buttons. Register is shown only when anyone can register.",
    icon: "👤",
    category: "site",
    schema: {
      showLogin: { type: "boolean", default: true },
      showRegister: { type: "boolean", default: true },
      loginLabel: { type: "text", default: "Log in" },
      registerLabel: { type: "text", default: "Register" },
      style: { type: "select", options: ["buttons", "links"], default: "buttons" },
      align: { type: "select", options: [...ALIGN], default: "right" },
    },
    validateProps: (raw) => {
      const r = raw as Record<string, unknown>;
      return {
        showLogin: bool(r["showLogin"], true),
        showRegister: bool(r["showRegister"], true),
        loginLabel: str(r["loginLabel"], "Log in") || "Log in",
        registerLabel: str(r["registerLabel"], "Register") || "Register",
        style: pick(r["style"], ["buttons", "links"], "buttons"),
        align: pick(r["align"], [...ALIGN], "right"),
      };
    },
    render: (props) => {
      const { showLogin, showRegister, loginLabel, registerLabel, style, align } = props as {
        showLogin: boolean;
        showRegister: boolean;
        loginLabel: string;
        registerLabel: string;
        style: string;
        align: string;
      };
      return `<nav class="jf-auth-links jf-auth-links--${esc(style)}${alignClass(align)}" data-jf-widget="auth-links" data-jf-style="${esc(style)}" data-jf-show-login="${showLogin ? "1" : "0"}" data-jf-show-register="${showRegister ? "1" : "0"}" data-jf-login-label="${esc(loginLabel)}" data-jf-register-label="${esc(registerLabel)}" aria-label="Account"><!--jf:auth-links--></nav>`;
    },
  },
];
