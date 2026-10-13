// SPDX-License-Identifier: MIT
import type { BlockDefinition } from "../registry/block-registry.js";
export const AUTH_FORMS = ["login", "register", "forgot-password", "reset-password"] as const;
export const authFormBlock: BlockDefinition = {
  type: "core.auth-form", version: 1, title: "Account form", icon: "⎆", category: "content",
  description: "Member sign-in, registration and password forms. Only rendered on sign-in pages.",
  schema: {
    form: { type: "select", default: "login", options: [...AUTH_FORMS], optionLabels: { login: "Sign in", register: "Create account", "forgot-password": "Forgot password", "reset-password": "Reset password" } },
    showLinks: { type: "boolean", default: true, label: "Show links to the other account pages" },
  },
  validateProps: raw => {
    const props = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const form = typeof props["form"] === "string" && (AUTH_FORMS as readonly string[]).includes(props["form"]) ? props["form"] : "login";
    return { form, showLinks: props["showLinks"] !== false };
  },
  render: props => `<div class="jf-auth-form" data-jf-auth-form="${props["form"]}" data-show-links="${props["showLinks"]}">Account form</div>`,
};
