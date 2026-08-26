# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting a vulnerability

Please report security issues privately. Do **not** open a public GitHub issue.

Email **security@justflows.com** with:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- Affected version / commit if you know it

You should receive an acknowledgement within a few days. Please give us a reasonable window to investigate and ship a fix before any public disclosure.

## Trust boundary

Justflows runs uploaded plugins, themes, CSS providers, and core-update archives **in the same Node.js process** as the site. An administrator who can upload a `.jfpkg` or core `.zip` can execute arbitrary code on the server. Treat those admin actions as equivalent to shell access.

This is by design for a self-hosted CMS. Production sites should restrict who is an administrator.

Since 0.1.2, package authenticity is checked by default: a `.jfpkg` is refused unless
it carries a valid marketplace signature or its SHA-256 digest is pinned in
`JUSTFLOWS_TRUSTED_PACKAGE_DIGESTS`. Setting `JUSTFLOWS_ALLOW_UNSIGNED_PACKAGES=1`
opts out and restores the pre-0.1.2 behaviour; do not set it on a public host.

Core update archives are the remaining unverified path — set
`JUSTFLOWS_UPDATE_SIGNING_KEY` or `JUSTFLOWS_UPDATE_DIGEST` to close it.

## Production hardening

Required:

- Set `APP_SECRET` to a unique value of at least 32 characters. Documented example values are rejected in production.
- Do not commit `.env` files, credentials, or private keys.
- Do not expose database ports to the public internet.

Strongly recommended before exposing admin on the public internet:

```
JUSTFLOWS_UPDATE_DIGEST=...
JUSTFLOWS_UPDATE_SIGNING_KEY=...
```

Package signature enforcement needs no configuration — it is the default. Pin your
own builds with `JUSTFLOWS_TRUSTED_PACKAGE_DIGESTS=<package-id>:<sha256>` rather
than turning enforcement off.

See `.env.example` and `.env.production.example` for the full list.

Also:

- Keep the site behind HTTPS and a reverse proxy, and set `TRUST_PROXY` to match
  your setup — the default (`loopback`) is right for nginx or Passenger on the
  same host. Getting this wrong makes per-IP rate limiting either useless or
  spoofable.
- Leave `DB_SSL` alone unless you have a reason: database TLS is on by default
  for any non-localhost `DB_HOST`.
- Complete first-run setup using the setup key from `install-token/TOKEN.txt`
  (also printed to the server log). Both points where an anonymous visitor could
  otherwise act ask for it: the browser first-run page, before it downloads
  dependencies and builds, and the install wizard's admin-account step. Requests
  from localhost are exempt from both. Open the file with the same FTP client or
  File Manager you used to upload Justflows. The folder ships an Apache deny rule
  and Node never serves it, but if your host puts the application root behind a
  web server you do not control, confirm the folder is not reachable over HTTP.
  It is deleted automatically once setup completes, along with the build log. Do
  not set `JUSTFLOWS_SKIP_INSTALL_TOKEN=1` on a reachable host.
- Turn on two-factor authentication (Admin → Security → Your account). Given the
  trust boundary above, an administrator password is a server credential; TOTP
  is the cheapest thing standing between a reused password and shell access.
  Recovery codes are shown once at enrolment — store them somewhere reachable
  without the phone.
- Review Admin → Security → Audit log after any incident, and set
  `JF_AUDIT_RETENTION_DAYS` to match your retention policy. It records sign-ins,
  privilege changes, and everything that installs or replaces code.
- Limit the administrator role to people you trust with the server.
- Leave the public REST API off unless you need it (Admin → Settings).

## Data protection

Justflows stores personal data in four places: user accounts, comment authors,
form submissions, and the audit log's IP addresses.

- **Subject access (GDPR Art. 15)** — `GET /api/users/:id/personal-data`
  returns everything held about one account as JSON. Generated on request; no
  copy is written to disk.
- **Erasure (GDPR Art. 17)** — `POST /api/users/:id/erase` anonymises comments,
  deletes that person's form submissions, and strips the address and user agent
  from their audit entries. Content is reassigned rather than deleted: erasure
  is a right over personal data, not a right to remove a site's articles.
- **Retention** — `JF_AUDIT_RETENTION_DAYS` (default 365) bounds the audit log.
  `JF_SUBMISSION_RETENTION_DAYS` bounds form submissions and is off by default,
  because a retention period is the operator's decision to make.

Justflows does not decide whether a request must be honoured, or what a lawful
retention period is. It provides the mechanism; the operator is the controller.
