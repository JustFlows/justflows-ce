# Progressive Web App (PWA)

Justflows can turn your public site into an installable Progressive Web App:
visitors on a supporting browser can add it to their home screen or desktop,
launch it with your branding and no browser chrome, and see a branded offline
screen instead of a browser error when their connection drops. It's an
optional, disabled-by-default feature configured entirely from **Settings →
PWA** — no file edits, plugin, or build step required.

## Enabling it

Go to **Settings → PWA** and turn on **Enable PWA**. Enabling requires an
**app name** and a **512×512 icon** — the page blocks the toggle and explains
why until both are set. Everything else has a working default.

## Icons

Upload one square image, at least 512×512 pixels, through the media library
picker. Justflows generates the 512×512 and 192×192 PNG sizes a manifest
needs from it (stored as ordinary media items, so they count toward your
library like any other upload) and reuses the 192px version as the Apple
touch icon — iOS accepts and scales a reasonably large touch icon, so there's
no separate 180×180 asset to manage. Uploading a smaller source is rejected
with a clear error rather than shipping a blurry, upscaled icon.

A **maskable icon** is optional. Some Android launchers crop any icon into a
circle or squircle; a maskable icon keeps your artwork inside that safe area
instead of being clipped. The settings page previews the safe-area crop.

## Colors, display mode, and start URL

- **Theme color** tints the browser/OS chrome around the app where supported.
- **Background color** shows briefly while the app's first screen loads.
- **Display mode** — Standalone (looks like a native app), Fullscreen, Minimal
  UI (a small back/reload bar), or Browser (opens like a normal tab). A
  browser that doesn't support the chosen mode falls back to the closest one
  it does.
- **Start URL** must be a public page on your own site. Admin, login,
  install, and API URLs are rejected outright, both in the UI and on save.

The manifest's `id` and the service worker's `scope` are always the site
root — not a setting — so this feature can never expose an unbounded or
arbitrary worker scope. This also means a reverse-proxy subdirectory
deployment works unmodified, since Express sees the full forwarded path
either way; there's no separate "whole site under a subdirectory" setting in
Justflows today.

## App shortcuts

Up to four extra destinations (a label and a public URL each) that show on a
long-press of the installed icon, on platforms that support shortcuts.
Unsupported platforms simply ignore them.

## Install prompt

When enabled, a small install banner appears once the browser signals the
site is installable (after a user interaction, never automatically). On
Chromium-based browsers this uses the browser's own install prompt; iOS
Safari never fires that event, so visitors there see a short "tap Share, then
Add to Home Screen" instruction instead. The banner remembers a dismissal
locally and never reappears once the app is already installed
(`display-mode: standalone`). Turning off the install prompt still leaves the
site fully installable through the browser's own menu — this setting only
controls Justflows' own banner.

The banner's **button label** and **explanatory text** are configurable (the
iOS "tap Share, then Add to Home Screen" instructions are platform-specific
and always shown as-is). **Show the PWA logo** toggles whether the banner
includes the community-adopted [PWA logo](https://github.com/webmaxru/progressive-web-apps-logo)
next to that text, or shows text only.

## Offline behavior

After the service worker has completed one successful online visit, a failed
navigation (including a fresh offline launch or a deep link opened while
offline) shows your configured **offline screen** — a title, a message, an
optional image, and a retry button — instead of the browser's own error page.

This is intentionally limited in the first release:

- **Pages and API responses are never cached.** Every navigation is
  network-only; only the fallback appears when the network fails. There is no
  offline reading of previously visited pages.
- **Static asset caching** (optional, on by default) only covers uploaded
  media, `theme.css`, theme/plugin assets, and CSS-provider files — bounded
  by a maximum entry count and a maximum age, both configurable. `/admin`,
  `/api`, `/login`, `/install`, non-GET requests, and anything carrying an
  `Authorization` header are never intercepted at all.
- Forms, comments, uploads, and any other write action simply fail with a
  normal network error offline — nothing is queued for later.

## Updates, disabling, and recovery

Saving any PWA setting bumps an internal cache version, so a visitor's
browser fetches a new service worker on its next check and cleans up the
previous version's caches once the new one activates — you never need to ask
visitors to clear anything manually. A visitor with the app open sees a small
"An update is available" toast with an explicit Reload action; nothing
reloads or discards in-progress input on its own.

Turning PWA off keeps `/sw.js` reachable at the same URL: it now serves a
small worker whose only job is to delete every Justflows PWA cache and
unregister itself, so an already-installed app recovers cleanly the next time
it's opened online. Disabling does **not** immediately uninstall the app from
a visitor's device or force their browser to drop its offline cache — that
part is entirely browser-controlled. Re-enabling later works without asking
visitors to do anything.

## Static export

[Static export](STATIC-EXPORT.md) includes a working PWA automatically when
one is enabled: the manifest, service worker, and offline page are seeded
into the crawl explicitly (the service worker's registration is an inline
script, invisible to normal link discovery) and written to the export like
any other file. Because a static export is a snapshot, the exported
`manifest.webmanifest` and `sw.js` only pick up a settings change on the next
export run — [static export's own auto-rebuild](STATIC-EXPORT.md) triggers
that the same way it does for content and settings changes elsewhere.

## Theme integration

A theme that renders through the shared `layout.ejs` public template gets the
manifest link, theme-color meta tag, and the registration/install scripts
automatically — nothing to add. A fully custom theme that doesn't use the
shared layout is responsible for including `<link rel="manifest"
href="/manifest.webmanifest">` and registering `/sw.js` itself if it wants
the feature; Justflows will not emit a duplicate manifest tag if one is
already present.

## Troubleshooting

- **No install prompt appears.** These settings configure eligibility; they
  don't guarantee a prompt on every device. The site must be served over
  HTTPS (the Diagnostics panel on the settings page reports this), the
  manifest must be reachable, and the browser must support installation at
  all — Firefox and many older browsers never offer one, and the site
  remains a fully usable website there regardless.
- **The manifest or icons 404.** Confirm PWA is enabled and saved, and that
  the configured icon still exists in the media library.
- **A stale offline screen after a settings change.** Wait for a visitor's
  browser to run its normal service-worker update check (browser-controlled
  timing), or have them hard-reload once.
- **Production package.** No build step or source checkout is required in
  production — the manifest and service worker are generated per request
  from stored settings, not compiled assets.
