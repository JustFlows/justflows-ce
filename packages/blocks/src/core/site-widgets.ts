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
      style: { type: "select", options: ["buttons", "icons"], default: "buttons" },
      align: { type: "select", options: [...ALIGN], default: "right" },
      showSystem: { type: "boolean", default: false },
    },
    validateProps: (raw) => {
      const r = raw as Record<string, unknown>;
      return {
        style: pick(r["style"], ["buttons", "icons"], "buttons"),
        align: pick(r["align"], [...ALIGN], "right"),
        showSystem: bool(r["showSystem"], false),
      };
    },
    render: (props) => {
      const { style, align, showSystem } = props as { style: string; align: string; showSystem: boolean };
      // The behaviour is carried entirely by data-jf-theme, which
      // /js/site-chrome.js picks up through a delegated listener.
      const button = (mode: string, icon: string, label: string) =>
        `  <button type="button" class="jf-color-scheme__btn" data-jf-theme="${mode}" aria-pressed="false" aria-label="${label}">
    <span class="jf-color-scheme__icon" aria-hidden="true">${icon}</span>
    <span class="jf-color-scheme__label">${label}</span>
  </button>`;
      const buttons = [button("light", "☀", "Light"), button("dark", "☾", "Dark")];
      if (showSystem) buttons.push(button("system", "◐", "Auto"));
      return `<div class="jf-color-scheme jf-color-scheme--${esc(style)}${alignClass(align)}" data-jf-widget="color-scheme" data-jf-style="${esc(style)}">
${buttons.join("\n")}
</div>`;
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
      style: { type: "select", options: ["codes", "names"], default: "codes" },
      align: { type: "select", options: [...ALIGN], default: "right" },
    },
    validateProps: (raw) => {
      const r = raw as Record<string, unknown>;
      return {
        style: pick(r["style"], ["codes", "names"], "codes"),
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
