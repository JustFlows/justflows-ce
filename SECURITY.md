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
- Complete the install wizard using the setup key from `install-token/TOKEN.txt`
  (also printed to the server log). Open it with the same FTP client or File
  Manager you used to upload Justflows. The folder ships an Apache deny rule and
  Node never serves it, but if your host puts the application root behind a web
  server you do not control, confirm the folder is not reachable over HTTP. It is
  deleted automatically once setup completes. Do not set
  `JUSTFLOWS_SKIP_INSTALL_TOKEN=1` on a reachable host.
- Limit the administrator role to people you trust with the server.
- Leave the public REST API off unless you need it (Admin → Settings).
