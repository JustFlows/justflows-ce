// SPDX-License-Identifier: MIT

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

  async function submit(): Promise<void> {
    if (kind === "login") {
      const totpBox = form.querySelector<HTMLElement>(".jf-auth-form__totp")!;
      const body: Record<string, string> = { email: value("email"), password: value("password") };
      if (!totpBox.hidden) body.totp = value("totp");
      const { ok, data } = await post("/api/auth/login", body);
      if (!ok) {
        if (data.totpRequired) {
          totpBox.hidden = false;
          input("totp")!.required = true;
          input("totp")!.focus();
        }
        show(typeof data.error === "string" ? data.error : "Sign-in failed. Please try again.");
        return;
      }
      // An AI connector's consent screen may have sent the visitor here; only
      // that page may be returned to, so `next` is not an open redirect.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(next && next.startsWith("/oauth/consent?") ? safePath(next, "/") : safePath(data.redirectTo, "/"));
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
