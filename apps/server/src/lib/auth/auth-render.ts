// SPDX-License-Identifier: MIT

import { getGeneralSettings } from "../settings/general-settings.js";
import { MIN_PASSWORD_LENGTH } from "./password-policy.js";

const PLACEHOLDER = /<div\b([^>]*\bdata-jf-auth-form="(login|register|forgot-password|reset-password)"[^>]*)>[^<]*<\/div>/g;

type Flags = { registration: boolean; reset: boolean };

const field = (id: string, label: string, input: string) =>
  `<label for="jf-auth-${id}">${label}</label><input id="jf-auth-${id}" ${input}>`;
const password = (id: string, label: string, autocomplete: string) =>
  field(id, label, `name="${id === "password-confirm" ? "confirm" : "password"}" type="password" autocomplete="${autocomplete}" minlength="${autocomplete === "current-password" ? 1 : MIN_PASSWORD_LENGTH}" required`);
const notice = (text: string) => `<p class="jf-auth-form__notice">${text}</p>`;
const form = (kind: string, inner: string, submit: string) =>
  `<form class="jf-auth-form__form" data-jf-auth="${kind}" novalidate>`
  + '<p class="jf-auth-form__message" role="alert" hidden></p>'
  + inner + `<button type="submit">${submit}</button></form>`;

function body(kind: string, flags: Flags): string {
  switch (kind) {
    case "login":
      return form("login",
        field("email", "Email", 'name="email" type="email" autocomplete="email" required')
        + password("password", "Password", "current-password")
        + '<div class="jf-auth-form__totp" hidden>'
        + field("totp", "Authentication code", 'name="totp" inputmode="numeric" autocomplete="one-time-code"')
        + "<small>Enter the code from your authenticator app, or a recovery code.</small></div>",
        "Sign in");
    case "register":
      if (!flags.registration) return notice("Registration is closed on this site.");
      return form("register",
        field("name", "Name", 'name="displayName" autocomplete="name" maxlength="255"')
        + field("username", "Username", 'name="username" autocomplete="username" minlength="2" maxlength="60" pattern="[A-Za-z0-9._\\-]+" required')
        + field("email", "Email", 'name="email" type="email" autocomplete="email" required')
        + password("password", "Password", "new-password")
        + `<small>At least ${MIN_PASSWORD_LENGTH} characters.</small>`,
        "Create account");
    case "forgot-password":
      if (!flags.reset) return notice("Password reset is not available on this site. Contact the site owner.");
      return form("forgot-password",
        field("email", "Email", 'name="email" type="email" autocomplete="email" required'),
        "Send reset link");
    default:
      return form("reset-password",
        password("password", "New password", "new-password")
        + password("password-confirm", "Confirm new password", "new-password")
        + `<small>At least ${MIN_PASSWORD_LENGTH} characters.</small>`,
        "Set new password");
  }
}

function links(kind: string, flags: Flags): string {
  const items = [
    kind !== "login" ? '<a href="/login">Sign in</a>' : "",
    kind === "login" && flags.reset ? '<a href="/forgot-password">Forgot your password?</a>' : "",
    kind === "login" && flags.registration ? '<a href="/register">Create an account</a>' : "",
  ].filter(Boolean);
  return items.length ? `<p class="jf-auth-form__links">${items.join("")}</p>` : "";
}

/**
 * Turn `core.auth-form` placeholders into the member sign-in, registration and
 * password forms. Only called for `auth`-type pages; anywhere else the block
 * stays an inert placeholder, so a credential form cannot be dropped onto a
 * cacheable public page. `/js/auth.js` submits the forms. Nothing here links to
 * or names the admin: staff use the admin's own pages under the admin path.
 */
export async function renderAuthBlocks(html: string): Promise<string> {
  if (!html.includes("data-jf-auth-form=")) return html;
  const flags: Flags = { registration: false, reset: false };
  try {
    const general = await getGeneralSettings();
    flags.registration = general.usersCanRegister === true;
    flags.reset = general.passwordResetEnabled === true;
  } catch { /* Treated as closed; the sign-in form still works. */ }
  let first = true;
  return html.replace(PLACEHOLDER, (_whole, attributes: string, kind: string) => {
    // One form per page: the script and the labels rely on unique field ids.
    if (!first) return "";
    first = false;
    const showLinks = /data-show-links="true"/.test(attributes);
    return `<div${attributes}>${body(kind, flags)}${showLinks ? links(kind, flags) : ""}</div>`;
  });
}
