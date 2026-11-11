// SPDX-License-Identifier: MIT

import {
  conditionalMediationAvailable,
  conditionalRequest,
  getPasskey,
  isCancelled,
  passkeysSupported,
  type CredentialJson,
  type RequestOptionsJson,
} from "../../admin-ui/src/lib/webauthn";

/**
 * The member auth forms rendered by lib/auth/auth-render.ts: sign in, create
 * account, forgot password and reset password. Site surface only — these never
 * send `adminPath`, so the API treats them as the members' pages.
 */
(() => {
  const found = document.querySelector<HTMLFormElement>("form[data-jf-auth]");
  if (!found) return;
  const form: HTMLFormElement = found;
  const kind = form.dataset.jfAuth;
  const message = form.querySelector<HTMLElement>(".jf-auth-form__message")!;
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement | null;
  const value = (name: string) => input(name)?.value ?? "";

  const readCsrf = () => {
    const match = document.cookie.match(/(?:^|; )jf_csrf=([^;]*)/);
    return match ? decodeURIComponent(match[1]!) : "";
  };
  const show = (text: string, tone: "error" | "success" = "error") => {
    message.textContent = text;
    message.dataset.tone = tone;
    message.hidden = !text;
  };
  /** Same-origin paths only: `//host` and `/\host` would leave the site. */
  const safePath = (target: unknown, fallback: string) =>
    typeof target === "string" && target.startsWith("/") && !target.startsWith("//") && !target.startsWith("/\\")
      ? target : fallback;

  async function post(url: string, body: Record<string, unknown>) {
    if (!readCsrf()) await fetch("/api/auth/csrf", { credentials: "same-origin" });
    const res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": readCsrf() },
      body: JSON.stringify(body),
    });
    let data: Record<string, unknown> = {};
    try { data = await res.json(); } catch { /* Answered by the caller. */ }
    return { ok: res.ok, data };
  }

  // The reset token is read once and removed from the address bar, so it is not
  // left in history, bookmarks or a screenshot.
  let token = "";
  if (kind === "reset-password") {
    const params = new URLSearchParams(window.location.search);
    token = params.get("token") ?? "";
    if (params.has("token")) window.history.replaceState(null, "", window.location.pathname);
    const invalid = () => {
      show("This reset link is invalid or has expired. Request a new one from the “Forgot your password?” page.");
      form.querySelectorAll("input, button").forEach((el) => { (el as HTMLInputElement).disabled = true; });
    };
    if (!token) invalid();
    else void post("/api/auth/password/reset/verify", { token }).then(({ data }) => { if (data.valid !== true) invalid(); }).catch(invalid);
  }

  /** An AI connector's consent screen may have sent the visitor here; only that page may be returned to. */
  const signedIn = (data: Record<string, unknown>) => {
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.assign(next && next.startsWith("/oauth/consent?") ? safePath(next, "/") : safePath(data.redirectTo, "/"));
  };

  /** The challenge issued after the password, when the account's second factor can be a passkey. */
  let secondFactor: RequestOptionsJson | null = null;

  async function login(passkey?: { ceremonyId: string; credential: CredentialJson }): Promise<void> {
    const totpBox = form.querySelector<HTMLElement>(".jf-auth-form__totp")!;
    const passkeyBox = form.querySelector<HTMLElement>(".jf-auth-form__passkey");
    const body: Record<string, unknown> = { email: value("email"), password: value("password") };
    if (passkey) body.passkey = passkey;
    else if (!totpBox.hidden && value("totp")) body.totp = value("totp");
    const { ok, data } = await post("/api/auth/login", body);
    if (!ok) {
      const options = data.passkeyRequired ? data.passkeyOptions as RequestOptionsJson | undefined : undefined;
      secondFactor = options && passkeysSupported() ? options : null;
      if (passkeyBox) passkeyBox.hidden = !secondFactor;
      if (data.totpRequired) {
        totpBox.hidden = false;
        input("totp")!.required = !secondFactor;
        const label = form.querySelector<HTMLLabelElement>('label[for="jf-auth-totp"]');
        if (label) label.textContent = data.totpAccepted === false ? "Recovery code" : "Authentication code";
        if (!secondFactor) input("totp")!.focus();
      }
      show(typeof data.error === "string" ? data.error : "Sign-in failed. Please try again.");
      return;
    }
    signedIn(data);
  }

  async function passwordless(credential: CredentialJson, ceremonyId: string): Promise<void> {
    const { ok, data } = await post("/api/auth/passkeys/login/verify", { ceremonyId, credential });
    if (!ok) { show(typeof data.error === "string" ? data.error : "This passkey could not sign you in."); return; }
    signedIn(data);
  }

  async function passkeyOptions(): Promise<RequestOptionsJson> {
    const { ok, data } = await post("/api/auth/passkeys/login/options", {});
    if (!ok) throw new Error(typeof data.error === "string" ? data.error : "Passkey sign-in is not available right now.");
    return data as unknown as RequestOptionsJson;
  }

  if (kind === "login" && passkeysSupported()) {
    let conditional: ReturnType<typeof conditionalRequest> | null = null;
    const signInButton = form.querySelector<HTMLButtonElement>('[data-jf-passkey="signin"]');
    const secondButton = form.querySelector<HTMLButtonElement>('[data-jf-passkey="second"]');
    const guarded = (action: () => Promise<void>) => async () => {
      await conditional?.stop();
      show("");
      try { await action(); } catch (error) {
        if (!isCancelled(error)) show(error instanceof Error && !(error instanceof DOMException) && error.message ? error.message : "The passkey could not be used. Try again, or sign in with your password.");
      }
    };
    if (signInButton) {
      const wrapper = signInButton.closest<HTMLElement>(".jf-auth-form__passkey-signin");
      if (wrapper) wrapper.hidden = false;
      signInButton.onclick = guarded(async () => {
        const options = await passkeyOptions();
        await passwordless(await getPasskey(options), options.ceremonyId);
      });
    }
    if (secondButton) {
      secondButton.onclick = guarded(async () => {
        if (!secondFactor) return;
        const options = secondFactor;
        await login({ ceremonyId: options.ceremonyId, credential: await getPasskey(options) });
      });
    }
    /** Offer saved passkeys in the email field's autofill where the browser supports it. */
    void conditionalMediationAvailable().then(async (available) => {
      if (!available) return;
      const options = await passkeyOptions().catch(() => null);
      if (!options) return;
      conditional = conditionalRequest(async (signal) => {
        try {
          await passwordless(await getPasskey(options, signal, true), options.ceremonyId);
        } catch (error) {
          if (!isCancelled(error)) show("The passkey could not be used. Please try again.");
        }
      });
    });
  }

  async function submit(): Promise<void> {
    if (kind === "login") {
      await login();
      return;
    }
    if (kind === "register") {
      const { ok, data } = await post("/api/auth/register", {
        email: value("email"),
        username: value("username"),
        password: value("password"),
        displayName: value("displayName").trim() || undefined,
      });
      if (!ok) { show(typeof data.error === "string" ? data.error : "Registration failed. Please try again."); return; }
      window.location.assign(safePath(data.redirectTo, "/"));
      return;
    }
    if (kind === "forgot-password") {
      const { ok, data } = await post("/api/auth/password/forgot", { email: value("email") });
      if (!ok) { show(typeof data.error === "string" ? data.error : "Something went wrong. Please try again."); return; }
      form.reset();
      show("If an account exists for that address, a reset link is on its way. Check your inbox.", "success");
      return;
    }
    if (value("password") !== value("confirm")) { show("The passwords do not match."); return; }
    const { ok, data } = await post("/api/auth/password/reset", { token, newPassword: value("password") });
    if (!ok) { show(typeof data.error === "string" ? data.error : "Something went wrong. Please try again."); return; }
    form.reset();
    form.querySelectorAll("input, button").forEach((el) => { (el as HTMLInputElement).disabled = true; });
    show("Your password has been changed. You can now sign in.", "success");
    window.setTimeout(() => window.location.assign("/login"), 2500);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    void (async () => {
      button.disabled = true;
      show("");
      try { await submit(); } catch { show("Something went wrong. Please try again."); } finally {
        if (kind !== "reset-password" || !message.dataset.tone || message.dataset.tone === "error") button.disabled = false;
      }
    })();
  });
})();
