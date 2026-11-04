# Secure self-hosting

This guide separates settings Justflows can verify from controls owned by the
host, reverse proxy, database, storage provider, or edge network. A passing
Security Center row is evidence for that row only; it is not certification of
the deployment.

## Minimum production baseline

- Run a supported Node.js release (currently Node.js 22 or later) and install
  security updates for Node, the operating system, database, proxy, container
  runtime, and Justflows.
- Set `NODE_ENV=production`, a public HTTPS `APP_URL`, and a unique random
  `APP_SECRET` of at least 32 characters.
- Terminate TLS at the public proxy or load balancer, redirect HTTP to HTTPS,
  and keep the Node listener private when a proxy fronts it.
- Set `TRUST_PROXY` to the actual proxy boundary. Never use `true` merely to
  make forwarded headers work.
- Run the app and database without root or superuser privileges. Give each
  installation its own database account and storage prefix.
- Back up the database, private storage, uploads, and required configuration;
  verify restoration separately under issue #19.

## TLS and public URLs

`APP_URL` is the canonical public origin. In production it must be an `https:`
URL with no trailing slash. It controls absolute links and whether session
cookies are marked `Secure`; a TLS proxy with an `http:` `APP_URL` is therefore
not equivalent.

The shipped [`docker/nginx.conf`](../docker/nginx.conf) enables TLS 1.2/1.3,
forwards the original protocol, redirects only when the operator enables the
port-80 return, and keeps `/uploads` behind the application. Replace its sample
certificate paths and `server_name`, then test both the public site and admin.
Apache, LiteSpeed, OpenLiteSpeed, Passenger, and nginx operators should also
copy the installation-specific rules from **Admin → Security → Web server**.

Only enable HSTS after every covered hostname serves HTTPS. `includeSubDomains`
and browser preload are long-lived commitments, not setup shortcuts.

## Proxy trust and client addresses

Justflows defaults `TRUST_PROXY` to `loopback`, suitable for nginx, Apache, or
Passenger on the same host. Client addresses feed rate limits and audit events;
trusting an attacker-controlled hop lets the attacker choose that address.

| Topology | Setting |
| --- | --- |
| Direct Node, no proxy | `TRUST_PROXY=false` |
| Same-host proxy | omit it or use `TRUST_PROXY=loopback` |
| Fixed proxy address/subnet | use the exact address or CIDR accepted by Express |
| Fixed number of hops | use a number only when every request follows that exact path |
| Multiple variable paths | prefer explicit proxy subnets; do not use a hop count or `true` |

The last trusted proxy must overwrite or safely append forwarded headers. The
nginx example uses `$proxy_add_x_forwarded_for` and sets
`X-Forwarded-Proto`; do not replace it with a raw client-supplied header.
Verify an audit event records the expected client address through every public
path, including an edge followed by an origin proxy.

## Edge CDN, WAF, and origin access

An edge service does not protect an origin that remains directly reachable.
When using a CDN or WAF:

1. Bind Node to loopback or a private network.
2. Firewall the public origin to the edge provider's current published egress
   ranges, plus a separately controlled operator path if needed.
3. Configure the edge to use HTTPS to the origin and validate the origin
   certificate.
4. Preserve the public `Host` and protocol, and set `TRUST_PROXY` only for the
   proxies actually in the path.
5. Bypass caching for the admin path, `/api`, `/oauth`, `/account`,
   `/platform-account`, and plugin account routes. Honor origin `private`,
   `no-store`, and `Set-Cookie` responses.
6. Test that the origin IP cannot serve the site directly.

Provider IP allowlists change; automate their refresh or monitor them. A paid
edge is optional—TLS, a host firewall, a same-host reverse proxy, and
application rate limits remain a supported self-hosted baseline. Application
rate limits do not absorb network-level DDoS traffic.

## Least privilege

### Operating system and containers

Run one unprivileged account per installation. The Docker image already uses
the `justflows` user; Compose sets `no-new-privileges` and drops all Linux
capabilities. Do not mount the Docker socket, host root, SSH keys, or unrelated
application directories into the web container.

The database should listen on a private interface or container network. Its
Justflows account needs schema creation and migration rights inside the one
assigned database, plus normal data read/write rights. It does not need a
server-wide superuser, role administration, or access to other databases.

### Object storage

Keep buckets private unless public media is an explicit choice. Scope the S3
credential to the configured bucket and `STORAGE_S3_PREFIX`, with only the
object list/read/write/delete operations Justflows needs. Do not reuse a cloud
account owner key. Leave `STORAGE_S3_PUBLIC_URL` unset when tenant files must be
authorized by the application; see [Media](MEDIA.md#storage).

## Secrets and rotation

Keep `.env` outside the public document root where the host permits it, readable
only by the application account, and out of source control, images, support
bundles, and backups shared with third parties. Prefer the host's secret store
for database, SMTP, S3, registry, signing, and AI-provider credentials.

Generate `APP_SECRET` with `openssl rand -base64 48`. Rotating it invalidates
signed sessions and can make values encrypted with the previous secret
unreadable. Before rotation, inventory encrypted SMTP, IMAP, AI, storage, and
other provider settings; schedule a maintenance window; replace the secret;
restart every worker; revoke sessions; and re-enter or rotate affected provider
credentials. Rotate a leaked database or storage credential at the provider
first, update every worker atomically, restart, verify, then revoke the old key.

## Writable boundaries

Do not grant the application account write access to the entire hosting account.
These locations may need writes, depending on enabled features:

| Path or setting | Purpose |
| --- | --- |
| `.env` | browser installation and administrator settings that persist environment values |
| `install-token/` | temporary setup proof; removed after installation |
| `STORAGE_LOCAL_PATH` (`uploads/`) | local public media |
| `PRIVATE_STORAGE_PATH` (`storage/private/`) or the S3 `.private/` prefix | private plugin files |
| `PACKAGES_DIR` (`packages-installed/`) | installed plugins and themes |
| `CSS_PROVIDERS_INSTALL_DIR` (`css-providers-installed/`) | installed CSS providers |
| `.updates/` | verified core-update staging, status, backup, and rollback |
| `CACHE_DIR` (`.cache/`) | bounded application caches |
| `STATIC_EXPORT_DIR` | local static/edge export output when enabled |
| `tmp/` | temporary runtime work |

Core updates currently replace application files, so an installation using the
built-in updater cannot make the whole application root read-only. If the host
deploys immutable images instead, disable built-in automatic updates, rebuild
from a verified release, and replace the container or release directory through
the host's deployment process. Never expose the writable paths above as static
web roots. In particular, proxy `/uploads` through Justflows or use the generated
internal-offload rule so `.trash`, `.private`, and another site's files remain
protected.

## Hosting-specific notes

- **Docker:** publish port 3000 only when it is intentionally public. Behind a
  same-host proxy, bind it to loopback (for example
  `127.0.0.1:${PORT:-3000}:3000`). Keep the database port unpublished.
- **nginx or Apache reverse proxy:** bind Node to loopback, use the forwarded
  header rules above, and set request-size/time limits deliberately.
- **Passenger/Plesk/cPanel:** use `server.js`, production mode, and the host's
  restart control. Confirm the application root and `install-token/` are not
  web-readable. Passenger on the same host uses the default `loopback` trust.
- **Apache/LiteSpeed document root:** preserve the shipped `.htaccess` first
  line and allow the generated rules. A vhost that disables overrides must copy
  those rules into its configuration.
- **Direct Node:** use `TRUST_PROXY=false`; bind to a private address unless Node
  itself is intentionally the public TLS endpoint.

## Verification checklist

After each proxy, credential, runtime, or storage change:

- open **Admin → Security** and resolve failed or unknown configuration checks;
- confirm the public URL redirects to HTTPS and cookies are `Secure`;
- request the origin IP directly and confirm it is unavailable when an edge is
  required;
- verify the audit log records the real client address, not the proxy or a
  spoofed forwarded value;
- confirm admin/API/account responses are never cached by the edge;
- run **Admin → System → Health** storage and database checks;
- verify `/uploads/.trash/`, `/uploads/.private/`, `.env`, `install-token/`,
  `.updates/`, and source/configuration paths are not publicly readable;
- check core and extension integrity after deployment;
- restore a synthetic backup in isolation rather than treating backup creation
  as proof of recovery.

Record external checks separately. Justflows cannot prove firewall policy, TLS
certificate validity as seen by every client, edge cache behavior, off-host
backup availability, or host compromise from inside the same process.
