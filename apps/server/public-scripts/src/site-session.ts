// SPDX-License-Identifier: MIT

/**
 * Apply the session to every sign-in link on the page.
 *
 * One session serves the admin and the site, so staff signed in at the admin
 * are signed in here too. Public pages come from a shared cache and the session
 * cookie is HttpOnly, so the server renders signed-out links for everyone and
 * this script fixes them up for a signed-in visitor, wherever they are — menu
 * items, the header's sign-in buttons, footer or content links:
 *
 * - a link to `/login` (or `/<locale>/login`) becomes "My account";
 * - a link to `/register` disappears, together with its menu item;
 * - the header's sign-in widget also gets a "Sign out" button.
 *
 * It only asks the server when the `jf_signed_in` hint cookie is present, so
 * anonymous visitors cost nothing, and the answer never names the admin.
 */
(() => {
  if (!/(?:^|; )jf_signed_in=1(?:;|$)/.test(document.cookie)) return;

  const root = document.documentElement;
  const readCsrf = () => {
    const match = document.cookie.match(/(?:^|; )jf_csrf=([^;]*)/);
    return match ? decodeURIComponent(match[1]!) : "";
  };
  /** Same-origin paths only: `//host` and `/\host` would leave the site. */
  const safePath = (target: unknown) =>
    typeof target === "string" && target.startsWith("/") && !target.startsWith("//") && !target.startsWith("/\\")
      ? target : "/account";

  /** `login` or `register` for a same-site link to that page (locale prefix allowed), else null. */
  function authTarget(link: HTMLAnchorElement): "login" | "register" | null {
    let url: URL;
    try { url = new URL(link.getAttribute("href") ?? "", window.location.href); } catch { return null; }
    if (url.origin !== window.location.origin) return null;
    const match = /^(?:\/[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)?\/(login|register)\/?$/.exec(url.pathname);
    return match ? (match[1] as "login" | "register") : null;
  }

  /** Change a link's visible words, keeping wrappers such as `.jf-nav__label` and any icon. */
  function relabel(link: HTMLAnchorElement, text: string): void {
    const label = link.querySelector<HTMLElement>(".jf-nav__label");
    if (label) label.textContent = text;
    else link.textContent = text;
    if (link.title) link.title = text;
    if (link.hasAttribute("aria-label")) link.setAttribute("aria-label", text);
  }

  async function signOut(): Promise<void> {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": readCsrf() },
      body: "{}",
    }).catch(() => undefined);
    window.location.reload();
  }

  function apply(accountUrl: string): void {
    const widgets = new Set<HTMLElement>();
    for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
      const target = authTarget(link);
      if (!target) continue;
      const widget = link.closest<HTMLElement>("nav[data-jf-session-account]");
      if (widget) widgets.add(widget);
      const labels = widget ?? root;
      if (target === "login") {
        link.href = accountUrl;
        link.removeAttribute("target");
        link.removeAttribute("rel");
        relabel(link, labels.dataset.jfSessionAccount || "My account");
        link.dataset.jfSignedIn = "true";
      } else {
        // A menu item holding only this link goes with it; otherwise just the link.
        const item = link.closest("li");
        (item && item.querySelectorAll("a[href]").length === 1 ? item : link).remove();
      }
    }
    for (const widget of widgets) {
      const account = widget.querySelector<HTMLAnchorElement>("a[data-jf-signed-in]");
      const out = document.createElement("button");
      out.type = "button";
      out.className = account?.className ?? "";
      out.textContent = widget.dataset.jfSessionSignout || root.dataset.jfSessionSignout || "Sign out";
      out.addEventListener("click", () => { out.disabled = true; void signOut(); });
      widget.append(out);
      widget.dataset.jfSignedIn = "true";
    }
  }

  void fetch("/api/auth/status", { credentials: "same-origin" })
    .then((res) => (res.ok ? res.json() : { signedIn: false }))
    .then((data: { signedIn?: boolean; accountUrl?: string }) => {
      // An expired or revoked session: the server has cleared the hint.
      if (data.signedIn === true) apply(safePath(data.accountUrl));
    })
    .catch(() => undefined);
})();
