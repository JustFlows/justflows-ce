# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

## [0.1.4] — 2026-08-26

### Added — server-side rendering

- The authenticated Vite/React admin now renders every route on the Express
  server and hydrates in the browser. Shared shell data and each route's initial
  reads are embedded as escaped, request-scoped state, eliminating duplicate
  startup Fetch/XHR requests while preserving API calls for later interactions.
- Production builds now emit separate `admin-ui/dist/client` and
  `admin-ui/dist/server` artifacts. Docker images, shared-hosting ZIPs,
  first-run readiness checks, and core updates require and ship both, so site
  owners never need to run a frontend build.
- Admin documents and pre-session pages explicitly send
  `X-Robots-Tag: noindex, nofollow, noarchive`. The public website remains independently
  server-rendered with its existing SEO metadata, canonical URLs, language
  alternates, sitemap, robots policy, and structured data.

Findings from a full source audit. Nothing here changes content, themes or the
public site; all of it is authentication, packaging and transport.

### Fixed — critical

- **Package installer path traversal.** `version` in a `.jfpkg` manifest was
  validated by a regex anchored only at the start, so `1.0.0/../../..` passed and
  the install path escaped `packages-installed` — into an `fs.rm()` and an
  `fs.rename()`. Reachable from plugin, theme, CSS-provider and marketplace
  installs, and it ran _before_ the signature check, so a package Justflows
  correctly refused could still overwrite files. The pattern is now anchored at
  both ends and the destination is confined independently of it.

### Fixed — high

- Package verification runs while the package is still staged, so a refused
  upload no longer stays on disk in its final install location.
- `POST /api/bootstrap` required no authentication: its origin check passed any
  request without an `Origin` header, so plain `curl` could spawn the installer.
  It now takes the setup key, with loopback exempt, and is rate limited.
- `GET /api/bootstrap/status` served up to 64 KB of the npm install log to
  anonymous callers and never checked install state. It now returns only the
  installed flag once set up, and releases the log only to a caller holding the
  setup key. The log is deleted when the install completes.
- Pages served by root `server.js` — `/login`, `/install`, `/`, `/assets/*` —
  carried no security headers at all, because they never reach Express. Under
  Passenger that was every pre-sign-in page, and the login form was framable.
- Content-Security-Policy applied only to the public site. The admin, whose
  session can install extensions and replace the core, ran with no policy. It
  now has its own strict, enforcing policy, graded by the Security screen.

### Added

- Password change (Admin → Security → Your account) and administrator-initiated
  password reset. Neither existed; a compromised credential could not be rotated
  from inside the product. Both revoke every existing session.
- Two-factor authentication (TOTP, RFC 6238) with single-use recovery codes.
  Secrets and codes are encrypted at rest.

### Added — compliance and supply chain

- **Administrative audit log.** New `audit_log` table (migration 0008) and an
  Admin → Security → Audit log screen. Records sign-ins and failed sign-ins,
  password changes and resets, 2FA enrolment, account creation, role changes and
  deletions, plugin/theme/CSS-provider installs and activations, core updates,
  security-header changes, and public-API toggles. Nothing recorded any of this
  before, so a compromise could not be reconstructed. Writes never throw into
  the action they describe. Retention defaults to 365 days
  (`JF_AUDIT_RETENTION_DAYS`), because the log holds IP addresses.
- **Subject access and erasure.** `GET /api/users/:id/personal-data` returns
  everything held about an account; `POST /api/users/:id/erase` anonymises
  comments, deletes that person's form submissions, and strips address and user
  agent from their audit entries. Content is reassigned, not deleted — erasure
  is a right over personal data, not over a site's articles. Form-submission
  retention is available via `JF_SUBMISSION_RETENTION_DAYS`, off by default.
- **SBOM and checksums.** Each release now ships a CycloneDX 1.5 SBOM (inside
  the archive and beside it) and a `.sha256` file. A zip uploaded by FTP was
  previously the one artefact nobody could verify — which sat oddly next to the
  strict signature checking applied to plugins.
- **Secret scanning in CI.** `scripts/scan-secrets.mjs`, Node builtins only.

### Fixed — compliance and supply chain

- `security.txt` was not valid under RFC 9116: the REQUIRED `Expires` field was
  absent, `Canonical` was a bare path where a URI is required, and `Policy`
  named a different repository. Now built per request so `Expires` cannot go
  stale on a long-lived process.
- GitHub Actions were pinned to mutable tags; they are now commit SHAs with the
  release recorded in a trailing comment. Added a repository-wide least-
  privilege `permissions` block, and one per job.
- The container build ran `corepack prepare pnpm@latest`, overriding the pinned
  `packageManager` — so the image used whatever pnpm shipped that day rather
  than the version the lockfile was written by. The base image is now pinned by
  digest, and there is a `HEALTHCHECK`.
- Compose files gained `no-new-privileges`, `cap_drop: ALL`, a memory limit and
  a healthcheck. `read_only` is deliberately not set, and says why: the install
  wizard writes `.env` into the application root and extension installs write
  beside it, so a read-only root filesystem would break setup.
- The release zip excluded `.env.*`, which took `.env.example` and
  `.env.production.example` with it — while README and SECURITY.md both told
  readers to consult them. The exclusions are now explicit.
- Node version drift: `engines`, `.node-version` and Docker all said 22 while CI
  tested on 26. CI now uses 22, matching the floor the project claims and the
  runtime it ships.

### Fixed — medium

- CSRF tokens are bound to the session revocation counter, so they rotate on
  sign-out and password change instead of being fixed for the life of the site.
  A related bug is fixed: when the CSRF cookie was missing but a session was
  present, the re-issued cookie was random and could never validate.
- Plugin HTTP routes are CSRF-checked, no longer receive the `Cookie` header,
  cannot overwrite security or CORS response headers, and now receive the
  caller's session so a handler can authorise.
- The reference `nginx.conf` no longer drops the `Content-Disposition` the app
  attaches to PDF uploads, repeats security headers inside every `location`
  (nginx does not inherit them), marks them `always` so they survive error
  responses, and sends `X-XSS-Protection: 0` to match the app.
- Route handlers no longer serialise exceptions into responses; the four
  unauthenticated install-wizard messages are opaque and the detail is logged.
- Marketplace requests have timeouts, and downloads are size-capped while
  streaming rather than after buffering.
- CSS-provider npm dependencies must name a published version or range — URLs,
  git references and local paths were accepted and then executed.
- The site URL is validated identically by the install wizard and by settings.
- Minimum password length is 12 everywhere; `POST /api/users` allowed 8.

### Fixed — low

- Admin → Users no longer renders a hard-coded account list or leaves **Send
  invite** disconnected. It now loads the site's users from the database and
  provides an administrator-only invitation endpoint that creates the account,
  assigns the selected role, generates temporary credentials, sends them by
  email, and reports mail-delivery failures without hiding a successful insert.
- `GET /api/blocks` needed no session. It enumerates every registered block type
  including plugin-contributed ones — a precise inventory of installed
  extensions — and ran two database queries per call.
- Sign-in was not scoped to a site, so with more than one site row the account
  chosen depended on database row order.
- `safePath()` in root `server.js` compared with `startsWith(base)` and no
  separator, which also accepts a sibling directory sharing the prefix. It now
  matches the containment check the rest of the codebase uses, and resolves
  symlinks.
- The settings read was unscoped and capped at 100 rows with no `ORDER BY`, so a
  site with enough plugin settings could silently lose `active_theme` from the
  result and fall back to the default theme.
- CSRF rejections were emitted before the security-header middleware ran, so
  those 403s went out bare. Headers are now registered first.
- Uploads had a 100 MB per-file cap and no total, so any author could fill the
  volume. Both are now limits (`JF_MAX_UPLOAD_MB`, `JF_MAX_LIBRARY_MB`), and an
  oversized file answers 413 instead of 500.
- Rate limiting had a flat window, which lets an attacker run at exactly the
  limit indefinitely. Exhausting a window now lengthens the next one, up to 8x,
  and throttled responses carry `Retry-After`.

### Fixed — PostgreSQL compatibility

Found while scoping the settings query; all three would have thrown on postgres.

- Settings reads hardcoded MySQL backtick quoting for the reserved `key`
  column, which is a syntax error in PostgreSQL. Quoting is now driver-aware.
- `UPDATE sites … ORDER BY created_at LIMIT 1` is a MySQL extension; the row is
  now addressed by id.
- The settings-write fallback used `UUID()`, `NOW()` and `ON DUPLICATE KEY`.
  It was unreachable in practice and has been removed in favour of the existing
  driver-aware helper.


## [0.1.2] — 2026-08-24

### Added

- Shared-hosting installs no longer need a terminal. Opening the domain shows a
  first-run `index.html` that runs `install:all` in the browser, then continues
  to the existing site wizard. The file is deleted once the site is installed.
  Git checkouts keep the developer `/install` path and cannot spawn that
  installer.

### Changed

- The README install guide matches the browser-first flow: shared hosting opens
  the domain (not `/install`), waits on `index.html`, then the site wizard;
  Docker and git checkouts are documented separately, including the setup key.

### Security

- Theme file reads (`justflows-theme.json`, patterns, demo home, styles) stay inside
  `themes/` or `packages-installed/`. A theme id or stored `installedPath` can no
  longer be joined straight into `readFileSync`.
- `/install`, `/login`, and `/register` are rate-limited with `express-rate-limit`
  before they `sendFile` the admin SPA. Unhandled-error and session-revocation
  logs pass request values through `logSafe` and `JSON.stringify` so they cannot
  inject log lines or format strings.
- CSS-provider default `input.css` is created with `wx` (no exists-then-write
  race). Bootstrap log tails `fstat` the already-open descriptor.
- CI no longer runs `actions/dependency-review-action`. That action needs GitHub
  Dependency graph, which public `justflows-ce` does not enable, so the job failed
  every PR. High/critical advisory gating remains `pnpm audit --audit-level high`.
- Fixed stored cross-site scripting in the SEO JSON-LD block. `buildSeoHeadHtml`
  serialised the page name, description, URL, and image with `JSON.stringify`,
  which escapes neither `<` nor `/`, so a content title or `seoTitle` field
  containing `</script>` closed the structured-data element and everything after
  it was parsed as HTML. Any account able to publish content — `author` and above —
  could run script on every public page, including for administrators browsing the
  site. The payload can read the non-`httpOnly` `jf_csrf` cookie and drive the
  admin API as the visitor. Structured data is now serialised through
  `jsonLdPayload()`, which escapes `<`, `>`, `&`, U+2028, and U+2029.

  Sites running 0.1.1 or earlier should audit `content.title` and the `seoTitle`
  and `seoImage` entries of `content.fields` for markup before upgrading.

- Content Security Policy is now **enabled and enforcing by default** on the public
  site. The policy is the one that already shipped in the Security screen
  (`default-src 'self'; object-src 'none'; script-src 'self'; …`). Its scope is
  `public`, so the admin interface is unaffected, and a stored configuration that
  deliberately disabled CSP is still honoured. A theme that relies on inline
  `<script>` or third-party script hosts will need those allowed under
  Admin → Security. `JF_SECURITY_HEADERS_DISABLED=1` restores the previous headers
  without database access.

- The Google tag no longer adds `'unsafe-inline'` to `script-src` when it cannot
  compute a hash for its inline snippet. It now degrades to not running rather
  than silently widening a policy the operator configured.

- Package authenticity is now **required by default**. A `.jfpkg` is refused unless
  it carries a valid marketplace signature or its SHA-256 digest is listed in
  `JUSTFLOWS_TRUSTED_PACKAGE_DIGESTS`; the rejection message includes the digest so
  it can be pinned. Previously every trust check fell through to a silent pass
  unless `JUSTFLOWS_REQUIRE_SIGNED_PACKAGES=1` was set. Set
  `JUSTFLOWS_ALLOW_UNSIGNED_PACKAGES=1` to restore the old behaviour.

- Plugin modules are imported only for plugins whose status is `active`. Installing
  a plugin previously executed its top-level code immediately, so there was no
  state in which a package could be installed but not run.

- CSS-provider `postInstall` can no longer read, write, or execute outside the
  provider directory. `input` must name a file inside the package — it was resolved
  against the application root, so a manifest could copy `.env` into `input.css`,
  which the public asset route then served. `output` is confined to the provider's
  `dist/` and may not begin with `-`. Tailwind runs from the resolved binary in the
  install directory instead of `npx --yes`, which would fetch and execute whatever
  the manifest's dependency specifier pointed at, defeating `--ignore-scripts`.

- The `/css-providers` route serves files only from the provider's `node_modules/`
  and `dist/` directories, and only regular files. Build scaffolding such as
  `input.css` and `package.json` is no longer reachable.

- Theme customizer values are validated against a CSS grammar before being written
  into `theme.css`. Colours, font stacks, and custom-property names must match an
  allowlist and range controls are clamped to their schema bounds, so an editor can
  no longer close the declaration and inject arbitrary rules — which bypassed
  `sanitizeCustomCss` entirely. Values supplied by a theme package's
  `css_variables` are checked at the same chokepoint.

- Zip extraction rejects archives containing symbolic links, which both `unzip` and
  `7z` would otherwise restore, letting an entry that passes every path check write
  outside the destination. Extraction now also passes `-:` / `-snld`, and the
  destination tree is re-checked afterwards. The 7z entry listing is parsed with
  `-slt` rather than by taking the last whitespace-separated token, which truncated
  any filename containing a space.

- `.jfpkg` archives are inflated through a streaming gunzip with a running size
  ceiling. `gunzipSync` materialised the whole stream before the expanded-size
  limit could apply, so a 50 MB archive expanding to tens of gigabytes exhausted
  memory first.

- Values written to `.env` are rejected if they contain a line break or null byte.
  Because dotenv keeps the first occurrence of a key and `APP_URL` is written before
  the generated `APP_SECRET`, a newline in the installer's site URL let the caller
  choose the session signing key. `.env` permissions are now set explicitly after
  every write instead of relying on the create-only `mode` argument.

- The installer requires a full `http://` or `https://` site URL.

- Public routes no longer reflect exception text. Seven handlers returned
  `String(err)` as `text/html`, which leaked internal detail to anonymous callers
  and could reflect request-derived content. A catch-all error handler was added as
  a backstop.

- Read access tightened on endpoints that were reachable by any signed-in user or
  by nobody at all. `GET /api/settings` returns the mail transport, admin address,
  and registration policy to administrators only — a self-registered subscriber
  could previously read the SMTP host and username. `/api/comments`, `/api/health`,
  `/api/plugins`, and `/api/updates` now require a role rather than just a session.
  `/api/themes`, `/api/themes/patterns`, `/api/languages`, and `/api/marketplace`
  required no authentication at all. The marketplace proxy also forces a JSON
  content type instead of echoing the upstream one.

- `trust proxy` is configured (default `loopback`, override with `TRUST_PROXY`).
  Without it `req.ip` was the reverse proxy's address for every request, so the
  login and public-API rate limits shared a single bucket for all traffic — one
  client could lock out everyone, and per-IP brute-force protection did not exist.
  `isSecureRequest` now reads `req.secure` instead of trusting `X-Forwarded-Proto`
  from any client.

- The rate-limit table is bounded. Keys are attacker-chosen (an email address, an
  IP), and nothing evicted them, so a stream of unique login attempts grew the map
  until the process ran out of memory.

- Filesystem cache entries are keyed by a hash rather than by a lossy transform of
  the key. `/foo-bar`, `/foo.bar`, and `/foo/bar` all wrote to the same file, so
  anyone able to create content could choose a colliding slug and take over another
  page's cached output for the TTL. Namespace invalidation still works by prefix.

- The `?submitted=` form confirmation no longer bypasses the page cache on demand.
  It is constrained to a valid form id and honoured only with a same-origin
  referer; previously any visitor could append it to any URL and force a full
  render on every request.

- Session tokens can be revoked. A `token_version` counter (migration
  `0006_session_revocation`) is embedded in the token and compared on every
  request, and logging out now bumps it — previously logout only cleared the
  cookie and a captured token stayed valid for its full 14-day life. Sites where
  the migration has not yet run keep working without revocation rather than
  signing everyone out.

- The CSRF token is derived from the session (`HMAC(APP_SECRET, userId)`) instead
  of being a random value compared against itself. The old double-submit check only
  proved the caller could read a cookie on the domain, so anyone able to set one —
  through a subdomain they controlled — could forge both halves. `POST /api/auth/login`
  is no longer exempt, closing login CSRF; the login page is issued a token with
  its HTML.

- Public form submissions are rate limited per IP, and the `Reply-To` derived from
  submitted data must be a well-formed address with no CR/LF — the installed
  nodemailer has open header-injection advisories, so this is validated here rather
  than relied on downstream. Mail subjects are stripped of line breaks.

- Analytics records at most 200 distinct referrer hostnames per day, counting the
  rest as `other`. The hostname comes from the visitor's `Referer`, so the set was
  unbounded and attacker-chosen.

- Uploads are checked against magic bytes for the declared MIME type. `file.mimetype`
  comes from the client's own `Content-Type` part header, so arbitrary content could
  be stored under an image extension. PDFs in `/uploads` are served with
  `Content-Disposition: attachment` rather than rendered in the site's origin.

- `esc()` escapes apostrophes, and the hero block's `background-image` uses double
  quotes inside `url()`. A media URL containing `'` could previously close the
  CSS function and append declarations.

- Database connections use TLS by default whenever `DB_HOST` is not localhost.
  Neither driver negotiated it, so a managed database was reached in cleartext.
  `DB_SSL` forces it either way; `DB_SSL_REJECT_UNAUTHORIZED=0` allows a
  self-signed server certificate.

- The install wizard requires a one-time setup key. Until setup completed, anyone
  who could reach the site could claim it and become the administrator, and the
  connection step doubled as an unauthenticated port scanner. The database error
  is now uniform, the host and database name are URL-encoded like the credentials
  already were, and the key is checked before any connection is attempted.

  The key is written to `install-token/TOKEN.txt`, so it can be read with the same
  FTP client or File Manager used to upload the release — shared-hosting customers
  have no terminal and no way to see a server log. The folder ships an Apache deny
  rule, Node never serves it, and it is deleted once setup completes. The key is
  also printed to the log for VPS and Docker operators, and requests from
  localhost are exempt so local development is unaffected.
  `JUSTFLOWS_INSTALL_TOKEN` supplies your own for automated provisioning;
  `JUSTFLOWS_SKIP_INSTALL_TOKEN=1` opts out.

  Install state is also confirmed against the `sites` table at boot, so an
  instance that loses its `.env` cannot reopen the wizard on a live database.

- `sanitizeCustomCss` normalises CSS escape sequences and comments before matching.
  `@\69 mport` and `url(\6a avascript:…)` mean the same thing to a browser as their
  plain spellings but sailed past a literal blocklist. It is still a blocklist —
  the allowlist is on the theme-mod path, which is where editor input actually
  reaches `theme.css`.

- Password verification reads the iteration count from the stored hash instead of
  assuming a constant, so raising the work factor no longer invalidates every
  existing password. The factor is raised to 600,000 (OWASP guidance for
  PBKDF2-HMAC-SHA256) and old hashes are upgraded transparently on next login.
  The minimum password length is now 12, in the installer and at registration.

- The WordPress importer uses `requireRole` like every other route, instead of
  reading the session token directly — a demoted or deleted administrator kept
  import rights until their token expired.

- The admin UI attaches its CSRF token only to same-origin requests. The global
  `fetch` wrapper previously added it to every non-GET request regardless of
  destination.

- Rich text rejects protocol-relative URLs (`//attacker.example`), which
  `sanitize-html` permits by default and which bypassed the scheme allowlist
  entirely. `sanitizeHref` matches the scheme without requiring `//`, so `mailto:`
  links work — every one of them was being rewritten to `#`.

- The SMTP password is encrypted at rest with AES-256-GCM under a key derived from
  `APP_SECRET`. This does not defend against a compromised server, which already
  has the key; it defends against a database backup or a read-only disclosure
  handing over a working credential. Values stored by an earlier release are read
  as plaintext and re-encrypted on the next save.

- `/.well-known/security.txt` (RFC 9116) points at `security@justflows.com`.

- CI gained a dependency audit that fails on high or critical advisories, a CodeQL
  scan with `security-extended`, and dependency review on pull requests.

### Fixed

- The admin sidebar reads the installed version from `package.json` instead of a
  hardcoded `v0.1.1`.
- Signing out no longer clears the CSRF cookie without replacing it. Client-side
  navigation to `/login` then posted without a token and failed with "Invalid
  CSRF token". Logout now issues a fresh anonymous token, and the login page
  asks `/api/auth/csrf` if the cookie is missing.
- Structured-data `description` is no longer HTML-encoded before being placed in
  JSON, so `&` and quotes reach consumers as written instead of as `&amp;`
- `nodemailer` in `apps/server` was pinned to `^7.0.13` while the root manifest
  declared `^9.0.5`; the workspace resolved to the older, vulnerable copy. Both now
  resolve to 9.0.5, and `sharp` to 0.35.3, clearing both high-severity advisories.

- `npm run install:all` no longer crashes npm 12 arborist
  (`Cannot read properties of null (reading 'matches')`) when a pnpm
  `node_modules` tree is present. Production hosting patches also keep the
  dependency versions from `package.json` instead of pinning stale ranges.
- The install wizard no longer hangs on "Connecting to database…" when the
  server cannot boot. `/api/install` errors are shown in the UI, gzip no longer
  buffers server-sent events, and the production server bundle inlines
  `@justflows/*` so Passenger does not need `node_modules/@justflows/core`
  before `npm install` finishes.
- The site wizard no longer runs while first-run dependencies are still
  installing. `/install` waits (or returns to the bootstrap page) until files
  are ready; `/api/install` is only posted after the last wizard step.
- `install-token/TOKEN.txt` is written when Node starts, not only when the
  install POST checks the key, so the File Manager folder exists before the
  admin-account step.

## [0.1.1] — 2026-08-22

### Added

- Persisted custom content types and fields (PostgreSQL, MySQL, and MariaDB)
- Public `/api/v1` REST surface with OpenAPI, CORS, and rate limiting
- Built-in SEO: titles, canonicals, Open Graph, JSON-LD, sitemap, and robots.txt
- Plugin and theme author documentation
- CI quality gate for core packages, installer contracts, and admin axe checks

### Fixed

- Core zip updates continue when multilingual unique indexes are already applied

## [0.1.0] — 2026-08-20

### Added

- Community Edition of the Justflows platform: unified Express server, admin UI, and public site
- Browser install wizard with PostgreSQL, MySQL, and MariaDB support
- Plugin, theme, and CSS-provider installation via `.jfpkg`
- Typed SDK and plugin API for extension authors
- Docker Compose variants and shared-hosting install scripts
