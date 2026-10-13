# Sign-in and password pages

Every sign-in flow exists twice, once for each audience:

| Flow            | Members (site visitors, customers)          | Staff (anyone who uses the admin)    |
| --------------- | ------------------------------------------- | ------------------------------------ |
| Sign in         | `/login`                                    | `<admin path>/login`                 |
| Create account  | `/register`                                 | none (staff are invited)             |
| Forgot password | `/forgot-password`                          | `<admin path>/forgot-password`       |
| Reset password  | `/reset-password`                           | `<admin path>/reset-password`        |
| Design          | the site's theme, edited in the page builder | the Justflows admin design          |

`<admin path>` is `/admin` until it is moved under **Security → Admin URL**.
Once it is moved, `/admin/login` and the other `/admin/*` pages answer 404 like
the rest of the old admin address. The member pages never link to or name the
admin path.

"Staff" means any account that lands in the admin after signing in: a role
with any capability beyond reading content. Subscribers, plugin roles such as
Shop's customer, and workspace owners on the installation's root site are
members.

## The server enforces the split

Hiding a page is not enough on its own, because every form posts to the same
API (`/api/auth/login`, `/api/auth/password/*`). Each request therefore names
the surface it came from: the admin pages send `adminPath`, read from their own
URL, and the member pages send nothing. A request counts as admin only when
`adminPath` matches the configured path exactly.

- **Sign in.** A staff account on the member page gets exactly the answer a
  wrong password gets: the same status, the same body, the same delay. It comes
  before any two-factor prompt, so nothing confirms that the password was right
  or that the account is staff. This holds on the default `/admin` path too.
  The attempt is recorded in the audit log as `auth.login_failed`.
- **Forgot password.** The member page never mails a staff account, and the
  admin page never mails a member. Either way the reply is the usual "if an
  account exists, a link is on its way". A staff link points to
  `<admin path>/reset-password`, so the hidden path only reaches its own owner.
- **Reset password.** A token only works on the page it was mailed for. On the
  other surface, checking or redeeming it reports an invalid link.
- **Register.** Members only. When the default role for new registrations is a
  staff role, the response still never contains a moved admin path.

Unauthenticated visits to the admin redirect to `<admin path>/login`, never to
`/login`. Signing out of the admin returns to the same page. Staff invitation
emails link to `<admin path>/login`; member invitations link to `/login`.

## While the site is offline or in maintenance

When the site is in maintenance mode or not yet public (Settings → Site
visibility), only the staff surface stays open, so staff can still sign in and
work on the site:

- `/login`, `/register`, `/forgot-password` and `/reset-password` show the same
  maintenance or under-construction page as the rest of the site, including the
  plain fallback form. If the check itself fails, they answer 503 rather than
  show a form.
- The member side of the API (`/api/auth/login`, `/register`,
  `/password/forgot`, `/password/reset/verify` and `/password/reset` without
  the admin path) answers `503` with one message for every request, before any
  account is looked up.
- Account pages close too. As everywhere else on a closed site, signed-in
  administrators and editors can still view them.
- `<admin path>/login`, `/forgot-password` and `/reset-password`, and API
  requests that name the admin path, work as usual.
- The anonymous public content API answers `404` while the site is not public
  and `503` during maintenance; signed-in administrators and editors keep
  access.
- The management API (`/api/manage/v1`) and MCP (`/api/mcp`) stay available.
  They are staff tools behind API keys or OAuth tokens that staff issue,
  limited to their owner's capabilities, so they belong with the admin and
  keep scripts, deploys and AI agents working while the site is closed.

## One session for both

The pages are separate, but the session is not. `jf_session` is a single
host-wide cookie, so signing in on either surface signs you in on both: staff
signed in at the admin are signed in on the site, and signing out anywhere
signs out everywhere.

- `/login`, `/register` and `/forgot-password` redirect a signed-in visitor to
  their account page (`/account`, or the published account page's URL). A
  `next=/oauth/consent?…` sign-in link continues to the consent screen instead.
  `/reset-password` stays open, because a reset link can be opened while signed
  in. An editor previewing these pages with `?preview=1` still sees them.
- Public pages come from a shared cache, so the server renders signed-out links
  for everyone. `/js/site-session.js` fixes them up in the browser for a
  signed-in visitor, wherever they appear (menu items, the header's sign-in
  buttons, footer or content): a link to `/login` or `/<locale>/login` becomes
  **My account**, a link to `/register` is removed together with its menu item,
  and the header's sign-in widget also gets **Sign out**.
- The script only runs its check when the readable `jf_signed_in=1` cookie is
  present. That cookie is set and cleared with the session and carries no
  identity; it only saves anonymous visitors a request. The check is
  `GET /api/auth/status`, which returns `{ signedIn, email, accountUrl }` or
  `{ signedIn: false }`, never a 401, never a role or the admin address, and
  clears a stale hint.

## Member pages (theme)

The built-in `auth` content type holds the member pages. Each site gets four
published pages with the slugs `login`, `register`, `forgot-password` and
`reset-password`. They are served at those fixed paths and edited under
Content → Sign-in with the normal page builder. They use the site's theme,
header, footer and styles. Theme template selection checks `auth-<slug>`,
`auth`, `page-<slug>` and `page` before the generic fallbacks.

Each page carries an **Account form** block (`core.auth-form`). Its **Form**
setting chooses sign in, create account, forgot password or reset password, and
**Show links** toggles links to the other member pages. Links appear only for
flows the site has switched on under Settings. When registration or password
reset is off, the block shows a short notice instead of the form. The block
renders a real form only on `auth` pages; anywhere else it stays an inert
placeholder. One form is rendered per page.

`/js/auth.js` and `/css/auth.css` are added to these pages only. The script
strips a reset token from the address bar before anything else runs.

### Privacy

`auth` pages are public, but they carry a CSRF cookie and credential forms, so
the content type always:

- sends `private, no-store` to browsers, `no-store` to CDNs, and
  `noindex, nofollow`;
- stays out of the page cache, public content APIs (including preview), search,
  sitemaps, permalink archives, static export, comments and taxonomies.

The reset page also sends `Referrer-Policy: no-referrer`. Page fields, themes
and plugin settings cannot weaken these rules, and the type has no
Cache-Control override.

### Installation and upgrades

Fresh installations and workspace sites seed the four pages in their default
locale. An existing site gets any missing page the first time one of the four
URLs is opened, or when its content types are next loaded. Seeding never
replaces a page that already exists under one of those slugs in any state:
customized, draft or trashed.

If a page is missing, unpublished or trashed, or its slug has been changed, its
URL falls back to the plain built-in form. That form uses the same member-only
rules. Only the default language is served at these paths.

## Staff pages (admin)

The staff pages are part of the admin app and use its design. They are served
only behind the admin path rewrite, with `private, no-store`,
`CDN-Cache-Control: no-store`, `noindex, nofollow` and
`Referrer-Policy: same-origin` (`no-referrer` on the reset page). Because they
are bare documents with no admin data embedded, the app reads the admin base
path from the page's own URL. There is no staff registration page:
`<admin path>/register` redirects to the staff sign-in.

On the installation's root site, the account page's **Admin sign-in** link for
each owned site goes through
`GET /api/account/workspaces/:id/sites/:siteId/admin-sign-in`. That endpoint
checks ownership, looks up that site's own admin path, and redirects, so the
path is never written into the page.

## Connecting AI apps

The OAuth consent screen (`/oauth/consent`) sends people who are not signed in
to the member page `/login`. Staff whose site uses a custom admin path should
sign in at their admin address first and then reopen the consent link; the
screen says so.

## Recovery

If you lose the admin address, set `JF_ADMIN_PATH_RECOVERY=/admin` in the
server's `.env` and restart. With no outgoing mail, reset a password from a
shell with `justflows user reset-password --email you@example.com`. See
[SECURITY.md](../SECURITY.md).
