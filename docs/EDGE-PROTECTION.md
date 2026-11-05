# Edge WAF, bot, and DDoS integration

Justflows works with or without a CDN, web application firewall (WAF), bot
service, or DDoS provider. These services can absorb traffic before it reaches
the host; Justflows rate limits requests only after they reach the application.
Application throttling protects expensive handlers and credentials, but cannot
protect a saturated network link, proxy, container host, or process.

This guide is provider-neutral. No external service, ruleset, reputation feed,
or automatic mitigation is configured by Justflows.

## Choose the boundary

Use one of these explicit topologies:

1. **No external edge:** public TLS reverse proxy → private Node process.
2. **External edge:** public edge → origin TLS proxy → private Node process.
3. **Static public pages:** public static/CDN host → private live origin for the
   dynamic routes documented in [Static export](STATIC-EXPORT.md).

For every request path, write down which component terminates public TLS, which
component is the last trusted proxy, and which component can reject traffic
before it consumes origin capacity. Avoid optional proxy paths that change the
number of hops; they make hop-count trust unsafe.

## DNS, TLS, and origin lockdown

1. Point public DNS at the edge only after the edge is configured and tested.
2. Use HTTPS from visitors to the edge and from the edge to the origin. Validate
   the origin certificate; do not use an insecure origin mode.
3. Keep `APP_URL` on the public HTTPS origin, not the provider hostname or
   private origin address.
4. Bind Node to loopback/private networking and expose only the origin proxy.
5. Firewall the origin proxy to the provider's current published egress ranges.
   Add a separately controlled operator path only when necessary.
6. Monitor provider range changes and update firewall rules before removing old
   ranges.
7. Verify the origin IP and provider-assigned origin hostname do not serve the
   application to arbitrary Internet clients.

IP allowlisting is the primary control. An origin header or secret path may add
defence in depth, but it is not a replacement for a network rule: a secret sent
on every origin request can leak through configuration, logs, or support data.
Justflows does not currently define a shared edge-origin authentication header.

## Proxy trust and real client addresses

The edge usually adds a provider-specific client-IP header. The origin proxy
must accept that header only from provider addresses, remove any client-supplied
copy, and construct a normal `X-Forwarded-For` chain for Justflows. It must also
set `X-Forwarded-Proto=https` and preserve the public `Host`.

Set `TRUST_PROXY` to the actual trusted proxy addresses/subnets. Hop counts and
`true` are refused because they do not identify a trusted machine. See
[Secure self-hosting](SELF-HOSTING-SECURITY.md#proxy-trust-and-client-addresses)
and the comments in [`docker/nginx.conf`](../docker/nginx.conf).

Test the chain with a synthetic request containing forged `X-Forwarded-For` and
provider-IP headers. The audit log must show the test client's address supplied
by the trusted edge, not the forged value, edge address, or origin proxy.

## Cache policy

Cache only anonymous `GET`/`HEAD` responses that the origin marks public. Never
cache a response carrying `Set-Cookie`, `Cache-Control: private`, or
`Cache-Control: no-store`. Do not let the edge override origin cache headers.

Bypass shared caching for these path families, including localized or renamed
admin paths where applicable:

| Paths | Reason |
| --- | --- |
| configured admin path, `/api`, `/oauth`, `/.well-known/oauth-*` | authenticated administration and APIs |
| `/login`, `/register`, `/forgot-password`, `/reset-password`, `/install` | authentication and installation state |
| `/account`, `/platform-account`, `/api/account`, `/api/platform-account` | private account data |
| `/ext/*/account`, `/api/*/account` | extension account APIs |
| preview URLs and requests with preview/authentication cookies | unpublished content |
| non-`GET`/`HEAD` methods | state changes and uploads |

The shipped nginx map already bypasses the account families. Static export
generates its own routing rules; do not turn an origin-only route into a cached
static response merely because it returns `200`.

Build cache keys from the public host, normalized path, query policy, encoding,
and any explicitly supported content variation. Do not include arbitrary
cookies or authorization values in a shared cache key; bypass instead. In a
multi-site installation, omitting the host can leak one site's page into
another site's domain.

## WAF rollout

Start managed rules in log/simulate mode. Review synthetic traffic and normal
administration, then enable blocking category by category. Prefer a narrow rule
exception scoped to an exact method and path over disabling a ruleset globally.

Do not challenge or rewrite machine-to-machine routes:

- `/api/v1`, `/api/manage/v1`, `/api/mcp`;
- `/oauth`, `/.well-known/oauth-*`;
- webhook receivers and plugin routes under `/ext` or `/api/<namespace>`;
- upload, update, package, static-export, and health endpoints.

These routes use API keys, OAuth, signatures, sessions, capabilities, CSRF, or
their own bounded inputs. A browser challenge returns HTML where a client
expects JSON and can break signatures by changing the body. Use rate limits,
authenticated allowlists, and exact WAF rules instead.

Browser challenges are more suitable for suspicious anonymous page traffic or
the first unauthenticated visit to a sign-in page. Never challenge a submitted
login, password-reset, form, comment, checkout, or upload request: it can lose a
body, duplicate a state change, or prevent an accessibility/privacy-sensitive
client from completing the flow.

Avoid rules that reject JSON, multipart data, long URLs, HTML, Markdown, code,
or archive bytes everywhere. A CMS legitimately carries those values. Scope
inspection to the route's actual contract and keep Justflows' own validation,
archive containment, sanitization, and upload limits enabled.

## Bot policy and rate limits

Separate traffic into operational classes instead of one global threshold:

- public cached pages and static assets;
- uncached public rendering, feeds, sitemap, and search;
- authentication, recovery, registration, and installation;
- comments, forms, checkout, and other state-changing public actions;
- administrator and account pages;
- API, MCP/OAuth, webhooks, and extension endpoints;
- uploads, image work, exports, updates, and other expensive operations.

Use the edge for coarse per-IP/network/ASN or reputation controls and burst
absorption. Keep application limits active because the application understands
accounts, API keys, sites, roles, and operation cost. Do not raise application
limits simply because an edge exists.

Allow verified search crawlers only when verification is based on the
provider's maintained signal or documented forward-and-reverse DNS procedure;
a user-agent string is not identity. Treat AI crawlers, uptime monitors, feed
readers, and accessibility tools as explicit policy decisions. Record what is
allowed, challenged, throttled, or blocked and provide a path to correct false
positives.

## WebSockets, streaming, uploads, and timeouts

- Forward WebSocket upgrade headers when an installed extension needs them;
  do not enable a broad cache on upgraded connections.
- Stream request and response bodies. Do not buffer large uploads twice unless
  the resource budget accounts for it.
- Keep edge and origin body-size limits at least as strict as the intended
  Justflows limit. A higher edge limit does not increase the application's
  bounded limit.
- Set edge/origin timeouts deliberately for updates, exports, image work, and
  streaming endpoints. Prefer asynchronous jobs over an unlimited HTTP timeout.
- Preserve range and conditional requests for media.
- Do not publicly alias the uploads directory; proxy it through Justflows or use
  the generated internal-offload rule.

## Logging, privacy, and incident evidence

Edge logs can contain IP addresses, URLs, query strings, cookies, request
bodies, and authorization headers. Minimize fields, redact credentials and
tokens, restrict access, define retention/deletion, and choose a lawful region
and processor agreement where applicable. Never enable full-body logging for
authentication, API, webhook, checkout, or upload traffic.

Keep edge event identifiers and timestamps so an administrator can correlate a
blocked request with the site-scoped Justflows audit log. Local audit logs are
not tamper-proof; see [Security event lifecycle](SECURITY-EVENTS.md).

## Failure modes, bypass, and rollback

Choose and document whether an edge outage fails closed or allows a controlled
origin bypass. A permanent public DNS record pointing directly at the origin
defeats origin lockdown. A safer emergency path is time-limited, access
controlled, monitored, and removed after use.

Before each ruleset change:

1. export the current edge configuration;
2. record the owner, reason, expiry, and rollback step;
3. test on a staging hostname or a provider preview/simulate mode;
4. keep an authenticated operator session and API probe ready;
5. roll back automatically when synthetic checks fail.

Do not disable origin authentication, Justflows authorization, CSRF, package
verification, or application throttling to recover from a WAF false positive.
Narrow or roll back the edge rule.

## No-paid-provider baseline

A supported baseline without an external service is:

- a host firewall exposing only 80/443 (and restricted administration access);
- nginx, Apache, Caddy, or another maintained TLS reverse proxy;
- Node bound to loopback/private networking with `TRUST_PROXY=loopback` for a
  same-host proxy;
- an unprivileged Justflows process and private database;
- origin request/body/time limits and Justflows application throttling;
- monitoring, backups, updates, and an incident runbook.

This baseline does not absorb a volumetric attack larger than the host's link or
proxy capacity. Operators needing that risk covered require upstream capacity
from their network or edge provider.

## Synthetic verification checklist

Run against a staging installation or controlled synthetic site, not customer
data:

- public HTTPS works and HTTP redirects once;
- direct origin access is denied;
- `Host`, scheme, and client address survive the full proxy chain;
- a forged forwarded address does not enter the audit log;
- anonymous public pages cache, while admin/API/account/auth responses do not;
- two site hostnames never share a cache entry;
- login, MFA, recovery, API keys, OAuth/MCP, webhooks, uploads, previews,
  comments/forms, updates, and extension routes keep their expected response
  type and body;
- WAF simulate logs contain no secrets or request bodies;
- safe synthetic bursts are limited at the intended edge and application
  layers without exhausting the origin;
- disabling the newest rule restores service according to the recorded rollback;
- the emergency path is inaccessible when not actively enabled.

Re-run these checks when proxy topology, edge provider, cache policy, ruleset,
public hostname, admin path, or a high-risk extension changes.
