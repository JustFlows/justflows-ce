# Cookie Consent (`justflows.consent`)

First-party consent management for Justflows CE. No third-party dependency — the
banner, the preference center, the consent API, and the audit store are all
served from your own origin.

Roadmap item:
[justflows-ce#113](https://github.com/JustFlows/justflows-ce/issues/113).

## What it does

- **Consent banner + preference center.** Categories `necessary` (always on),
  `preferences`, `analytics`, `marketing`. Accept-all and reject-all carry equal
  weight; each optional category has its own toggle. The preference center is a
  focus-trapped modal with `Esc` to close, screen-reader labels, and it respects
  `prefers-reduced-motion`. It renders after first paint and never blocks it.
- **Consent API.** The runtime exposes `window.justflowsConsent`:

  ```js
  window.justflowsConsent.get("analytics"); // boolean — category granted?
  window.justflowsConsent.allowed("_ga"); // boolean — is this cookie name allowed?
  window.justflowsConsent.all(); // { necessary, preferences, analytics, marketing }
  const off = window.justflowsConsent.onChange((choices) => {
    /* … */
  });
  window.justflowsConsent.open(); // open the preference center
  window.justflowsConsent.acceptAll();
  window.justflowsConsent.rejectAll();
  window.justflowsConsent.save({ analytics: true });
  ```

  A `justflows:consent-ready` event fires on `document` once the API is live.

- **Cookie registry.** Every plugin that sets a non-essential cookie declares it
  through the core `ctx.cookies.declare(...)` hook (category, purpose, provider,
  duration). This plugin fetches the resolved registry
  (`GET /ext/justflows.consent/cookies`) and:
  - lists the cookies for each category inside the preference center;
  - **expires** every cookie of a category the moment that category is denied or
    withdrawn, across the host and its parent domains;
  - resolves `window.justflowsConsent.allowed("<name>")` against it.

  Operators re-classify a cookie in **Cookie declarations** on the admin page
  (stored site-wide via `PUT /api/cookies/overrides`); `necessary` cookies are
  always allowed.

- **Script gating.** Any script tagged for a category stays inert until that
  category is granted:

  ```html
  <script type="text/plain" data-jf-consent="analytics">
    /* inline */
  </script>
  <script type="text/plain" data-jf-consent="marketing" data-jf-src="https://…"></script>
  ```

  The operator's **Analytics head snippet** / **Marketing head snippet**
  (Admin → Extensions → Cookie Consent) are injected already tagged. The Google Tag
  configured in the first-party Analytics plugin is gated automatically through
  the `analytics.head` hook.

- **Embed gating.** With _Gate embeds_ on, off-site `<iframe>` / oEmbed content in
  page bodies is replaced with a placeholder until `marketing` is granted, or the
  visitor unlocks that single embed with its button.
- **Consent records.** Every decision is stored first-party with the policy
  version, a SHA-256 hash of the policy (version, privacy URL, offered
  categories, gated snippets — not the localized text), the timestamp, the
  choices, the locale, and a coarse device class (no IP, no raw user-agent).
  Export as CSV or erase a single record from the admin page.
  Endpoints: `GET /ext/justflows.consent/records[.csv]`,
  `DELETE /ext/justflows.consent/records/:cid` (administrator session).
  **Audit logging can be switched off** (_Behaviour → Store an audit record…_):
  the banner still enforces choices, but nothing is written to `plugin_data` and
  the runtime sends no beacon — use it when the audit trail is not needed and
  table growth matters.
- **Display mode.** `always`, `eu` (best-effort — the visitor's timezone, no geo
  lookup), or `off`.
- **Multilingual.** Every visitor-facing string (banner title/body, button
  labels, category names and descriptions, blocked-embed note) is stored per
  locale under `translations["<code>"]`. Admin → Cookie Consent shows one tab per
  active site language; the runtime picks the visitor's language from
  `<html lang>` (exact, then base language, then the default locale). Editing a
  translation does **not** invalidate stored consent — only a `policyVersion`
  bump does.
- **Design & placement.** Admin → Cookie Consent → _Design & placement_:
  - **Layout** — `bar` (full-width strip), `box` (floating card), or `modal`
    (centered, dims and blocks the page until a choice is made).
  - **Position** — `top` / `bottom` for a bar; the four corners plus
    top/bottom-center for a box; `modal` is always centered.
  - **Colours** — inherit the active theme by default, or set background, text,
    accent, accent-text, border and the modal backdrop explicitly. Values are
    validated (`#hex`, `rgb()/rgba()/hsl()/hsla()`, named, or a short length) and
    applied as CSS custom properties, never spliced into a stylesheet.
  - **Shape** — panel radius, button radius, panel width.
    A live preview reflects the current design and the active language.
    For rules the panel does not cover, _Appearance → Customize → Additional CSS_
    still wins the cascade — target the `.jf-consent*` / `.jf-consent-embed*`
    classes.

## Build

```bash
pnpm --filter justflows.consent build
```

Emits `dist/index.js` (server module), `dist/styles/consent.css` (appended to
`/theme.css`), and `dist/runtime/runtime.js` (the public runtime, served from
`/ext/justflows.consent/runtime.js`).

Activate under Admin → Plugins, then configure under **Extensions → Cookie
Consent** (a tab next to Plugins / Marketplace).

## Notes and limits

- The consent beacon (`GET /ext/justflows.consent/record`) is a `GET` on purpose:
  an anonymous visitor has no CSRF token, so a `POST` would be rejected by the
  host. The payload is tiny and idempotent (the server skips a write when the
  stored choices and policy hash are unchanged).
- Deleting the plugin keeps consent records unless
  _Delete consent records when this plugin is removed_ is enabled in plugin
  settings.
- Deeper wiring into privacy-settings retention (#66) and the platform
  export/erasure subsystem (#71), and signed-marketplace packaging (#21), are
  follow-ups.
