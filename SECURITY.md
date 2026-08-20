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

This is by design for a self-hosted CMS. Production sites should restrict who is an administrator and should enable package authenticity checks.

## Production hardening

Required:

- Set `APP_SECRET` to a unique value of at least 32 characters. Documented example values are rejected in production.
- Do not commit `.env` files, credentials, or private keys.
- Do not expose database ports to the public internet.

Strongly recommended before exposing admin on the public internet:

```
JUSTFLOWS_REQUIRE_SIGNED_PACKAGES=1
JUSTFLOWS_TRUSTED_PACKAGE_DIGESTS=...
JUSTFLOWS_UPDATE_DIGEST=...
JUSTFLOWS_UPDATE_SIGNING_KEY=...
```

See `.env.example` and `.env.production.example` for the full list.

Also:

- Keep the site behind HTTPS and a reverse proxy.
- Limit the administrator role to people you trust with the server.
- Leave the public REST API off unless you need it (Admin → Settings).
