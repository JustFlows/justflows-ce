# Redirect manager

Administrators manage redirects at **System → Redirects** (`/admin/redirects`,
or the equivalent configured admin URL). Create or edit a rule, choose its
status and destination, and save. Disable a managed rule to stop applying it.
Changes and CSV imports are recorded in the administrative audit log.

## Matching and precedence

Redirects apply to GET and HEAD requests before public content rendering and
HTML cache lookup. They intentionally override existing public content URLs.
Static assets, platform routes (including the configured admin path, API and
locale-prefixed reserved paths), and registered plugin routes take precedence.
Preview requests and other HTTP methods bypass the manager.

Rules match the full case-sensitive, URL-encoded path, including any locale
prefix. `/old` and `/nl-NL/old` are different sources. Locale prefixes are not
implicitly added to destinations; content targets follow their active locale
and the configured permalink structure and homepage setting.

Priority is exact path, longest prefix, then regex (longest source expression,
then stable rule ID). Automatic permalink history runs after managed rules.
Each source/match-type combination must be unique,
including disabled rules. A site supports up to 1,000 managed rules.

| Match type        | Source                  | Destination       | Result                                          |
| ----------------- | ----------------------- | ----------------- | ----------------------------------------------- |
| Exact             | `/old-page`             | `/new-page`       | Only `/old-page` matches                        |
| Prefix / wildcard | `/old/`                 | `/new/$1`         | `/old/a/b` becomes `/new/a/b`                   |
| Regex             | `^/news/(\d+)/([^/]+)$` | `/articles/$2/$1` | `/news/42/launch` becomes `/articles/launch/42` |
| Regex             | `^/legacy/(.*)$`        | `/archive/$1`     | Captures the remaining path                     |

A prefix ends in `/`; enter `/old/` rather than `/old/*`. `$1` is the suffix.
Regex sources are limited to 512 characters and must start with `^/` and end with `$`. Supported syntax is literal
ASCII letters, digits, `/`, `_`, `%`, `~`, `-`, segment captures `([^/]+)` and
`(\d+)`, and an optional final `(.*)`. Segment captures must end at `/` or the
end of the expression. Up to nine captures can be referenced as `$1`–`$9`.
Alternation, arbitrary quantifiers, nested groups, backreferences, lookarounds,
and flags are rejected to keep public matching bounded.

Only the Plain permalink identity query (`?p=<id>`) participates in matching.
Other incoming query parameters are dropped when a managed redirect applies;
put any desired fixed query parameters in the destination. Sources cannot
contain fragments or arbitrary query strings. Captures come from the pathname,
never from request headers, hosts, or query parameters.

## Destinations and chains

Choose an internal absolute path, a published content item in an active locale,
or an absolute HTTP(S) URL. Content targets store the content ID and resolve its
current canonical URL. If content becomes unavailable, that managed rule does
not redirect. External URLs cannot contain credentials or a dynamic host.
Protocol-relative URLs, backslashes, traversal and encoded control characters
are rejected, including after capture substitution. External destinations are
operator configured; there is no public `next`/`url` redirect endpoint.

Choose 301, 302, 307 or 308. The manager checks the combined rules and historical
permalink redirects for cycles before saving. Pattern combinations that _could_
form a cycle are conservatively rejected; narrow the pattern to disambiguate.
Chains over 32 hops are rejected before saving.
Known canonical locale and trailing-slash destinations are resolved directly.
URLs on the configured site origin are treated as internal during resolution.
Other external origins are terminal; redirects controlled by external servers
and additional proxy/domain aliases cannot be inspected.

Equal-status chains collapse during evaluation without rewriting stored rules.
For example, `/a → /b → /c`, all 301, returns one 301 to `/c`. Mixed-status chains
retain their original hops to preserve temporary/permanent semantics. Runtime
cycle checks inspect the full chain even when statuses differ. A cycle created
by a later content/configuration change, an unsafe expansion or more than 32
hops causes the managed redirect to fall through to normal routing.

Rules and derived context use the site cache with a five-second TTL when caching
is enabled. Writes invalidate rule and page caches; normal content invalidation
also covers the derived content context. Workers with independent memory caches
can take up to five seconds to observe rule changes. Redirect responses use
`Cache-Control: no-store`, so local testing of edits does not leave stale browser
redirects behind.

## URL change suggestions

Slug and permalink structure changes already retain historical published URLs
and serve automatic 301s (see [Permalinks](PERMALINKS.md)). The **URL change
suggestions** section exposes those known old content and taxonomy URLs. Review
a suggestion to prefill a managed redirect and choose a different status or
destination. Content suggestions prefer an identity-linked destination.
Saving an enabled exact rule overrides the historical redirect; disabling it
restores automatic permalink handling. The manager does not discard history.
Unpublished/deleted targets and ambiguous old URLs are not suggested.

## 404 reporting

The **404 log** shows path, hit count, latest referrer, and first/last seen.
**Create redirect from this 404** prefills the source and focuses the destination
field. Choose a destination and save. The historical 404 row stays available
until retention or **Clear 404 log** removes it.

Only finished public GET responses with status 404 are recorded, including
cached public 404 responses. Reserved routes, previews, HEAD and non-GET requests
are excluded. Query strings, fragments, IP addresses and user agents are not
stored; referrers retain only origin and path, without credentials. A path is
limited to 2,048 characters and the latest referrer to 512 characters.

Counts update atomically across workers. Storage is capped at 10,000 distinct
paths per site; existing paths continue counting at the cap. Entries older than
30 days are hidden on reads and pruned on subsequent 404 writes. Logging is best
effort: no more than 32 writes are in flight per process, and the public request
limiter runs before matching. Counts may underreport during overload or a database
outage. Logging failure does not change the public response.

## CSV and API

Export downloads the current managed rules, including disabled ones. Import
accepts up to 500 rows and 1 MiB per request. All rows validate before the
transaction writes anything; duplicate sources and loops reject the entire
import. Import adds rules; it does not replace or overwrite existing rules.

```csv
source,kind,targetType,target,status,enabled
/old-page,exact,internal,/new-page,301,true
/old/,prefix,external,https://example.org/archive/$1,308,true
```

Quoted CSV fields, escaped quotes, LF/CRLF, and a UTF-8 BOM are supported.
`enabled` must be `true` or `false`; `kind` is `exact`, `prefix` or `regex`;
`targetType` is `internal`, `content` or `external`. A content destination is its
UUID. Export supplies the exact header and does not include IDs or 404 data.

All API operations require an administrator session and use normal API CSRF
protection for writes. Automation must supply the authenticated session and
its CSRF token; this does not add an anonymous or API-key access path.
The API is limited to 120 requests/minute per client.

| Method | Path                                | Body / response                                                  |
| ------ | ----------------------------------- | ---------------------------------------------------------------- |
| GET    | `/api/redirects`                    | `{ rules, content, suggestions }`                                |
| POST   | `/api/redirects`                    | Rule body → `201 { rule }`                                       |
| PUT    | `/api/redirects/:id`                | Complete rule body → `{ rule }`; set `enabled: false` to disable |
| GET    | `/api/redirects/export`             | CSV attachment                                                   |
| POST   | `/api/redirects/import`             | `{ "csv": "…" }` → `201 { rules }`                               |
| GET    | `/api/redirects/not-found?offset=0` | `{ entries }`, newest first, 100 per page                        |
| DELETE | `/api/redirects/not-found`          | Clear the site's log → `{ ok: true }`                            |

```json
{
  "source": "/old-page",
  "kind": "exact",
  "targetType": "internal",
  "target": "/new-page",
  "status": 301,
  "enabled": true
}
```

Validation returns 400, missing edited rules return 404, and authentication and
role failures return 401/403. Audit actions are `redirect.created`,
`redirect.updated`, `redirect.imported` and `redirect.logs_cleared`.
Migration `0025_redirect_manager` adds the rules and aggregate 404 tables for
PostgreSQL, MySQL and MariaDB; normal startup applies it. This is a server runtime
feature: static exports do not reproduce redirect rules or collect 404s. Configure
redirects separately on a static host/CDN when serving without the Justflows server.
