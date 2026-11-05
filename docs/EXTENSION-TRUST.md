# Extension trust

Plugins, themes, and CSS providers run in the same Node.js process as the site.
They are trusted server code. Justflows does not sandbox them.

Installing an extension gives its publisher the same level of access as shell
access to the application account. Decide whether you trust the publisher before
you install, and limit who holds the administrator role.

## What the SDK constrains

Manifest permissions and the SDK define what well-behaved extensions may do.

- `ctx` APIs check the permissions declared in the extension's manifest. See
  [permissions](PERMISSIONS.md).
- The host checks site activation, user capabilities, and explicit site selectors
  before it calls a plugin's API handlers.
- User access never expands what a plugin's manifest allows.

These checks are a contract for extensions that use the SDK. They are not a
security boundary against an extension that chooses to ignore it.

## What same-process code can still reach

Code running in the server process can bypass the SDK. It can use any Node.js API
and reach whatever the application account can, including:

- environment variables, such as `APP_SECRET` and database credentials;
- files the application account can read or write;
- the database, with the application's privileges and across tenants that share
  it;
- outbound network connections;
- the memory of the running process, including other extensions and core.

The host also cannot tell whether an opaque resource ID in a plugin's own
database belongs to another site. Plugin handlers must enforce site ownership
themselves.

## What signatures and integrity checks prove

| Check             | Proves                                                          | Does not prove                                          |
| ----------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| Package signature | The package came through the marketplace signing key unchanged  | The code is safe or free of vulnerabilities             |
| Pinned digest     | The package matches the digest the operator chose to trust      | Anything about the code's behavior                      |
| File integrity    | Installed files still match the baseline from a trusted install | The original package was harmless, or the host is clean |

An installation with no baseline is unverified, which is not the same as passing.
Do not describe a signature, an integrity pass, or a quality check as a guarantee
of safety.

## Decision: untrusted extensions are not supported

**Status:** Accepted. This records current behavior.

**Context:** Multi-tenant and self-hosted operators may want to run extensions
from publishers they do not fully trust. Justflows loads extensions into the
server process, so permissions and signatures cannot contain them.

**Decision:** Justflows CE restricts extension installation to trusted operators
and trusted code. It does not offer or advertise a sandbox.

**Consequences:**

- Installing a package or core update stays an administrator-only action, and
  operators should treat it as equal to shell access.
- Signature enforcement stays on by default. Do not set
  `JUSTFLOWS_ALLOW_UNSIGNED_PACKAGES=1` on a public host.
- Do not let tenants upload their own server-side extensions on a shared
  installation.
- Running untrusted code would need a separate project with enforceable operating
  system or process boundaries, and demonstrated isolation before it could be
  described as a sandbox.

If you suspect a compromised extension, follow
[incident response](INCIDENT-RESPONSE.md).

## Update trust policy

Marketplace installs and updates fail closed. Justflows downloads packages only
through the configured Marketplace API, bounds the request and archive size, and
requires the archive digest to match a signature from a Marketplace key trusted
by this core release. A missing, unreachable, or invalid trust service never
falls back to an unsigned update. Operators can explicitly pin a package digest;
the development-only `JUSTFLOWS_ALLOW_UNSIGNED_PACKAGES=1` escape hatch is not a
production trust policy.

Marketplace signing keys rotate through a core release. During a planned
rotation, a release can trust both the retiring and replacement public keys;
after publishers and operators have upgraded, a later release removes the old
key. An emergency revocation removes the affected key from a security release.
Already installed code remains subject to the signed advisory feed and file
integrity checks, because removing a key cannot prove that existing files are
safe.

The update action accepts only a SemVer version newer than the installed one.
Reinstalling the same version or downgrading through the update API is refused.
Recovery from a withdrawn or broken release uses a deliberate trusted reinstall
or backup restore, with the administrator choosing the exact signed package or
pinned digest; it is not an automatic downgrade. Automatic updates also stop at
a major-version boundary and wait for a person when a plugin adds permissions.
