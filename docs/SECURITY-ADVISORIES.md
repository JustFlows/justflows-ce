# Security advisories

**Admin → Security** checks installed core, plugin, and theme versions against a
signed advisory feed. This check is separate from update availability: an update
notice says a newer version exists, and an advisory says your version is affected.

## What the check reports

| Result       | Meaning                                                                        |
| ------------ | ------------------------------------------------------------------------------ |
| Pass         | A verified, current feed lists nothing that affects this installation          |
| Warn or fail | An advisory applies. High, critical, and withdrawn versions show as a failure  |
| Unknown      | No verified feed is available, or the feed has expired, so nothing was checked |

A pass covers published advisories only. It does not show that the installation
is free of vulnerabilities. The check runs on the installation root and covers
core, plugins, and the root site's themes.

Justflows refreshes the feed shortly after boot and then every six hours, and the
page itself never calls the network. The server must be able to reach
`api.justflows.com`. If it cannot, the check stays unknown or goes stale.

## Withdrawn versions

An advisory can mark versions as withdrawn when the publisher no longer stands
behind them. Justflows reports this and does not change anything for you. Update
to a fixed version, or deactivate the extension until one exists. Deactivating
leaves the site's data in place. For a suspected compromise, follow
[incident response](INCIDENT-RESPONSE.md).

## How the feed is trusted

The feed is signed with the core release key, and the signature is checked against
the public key pinned in core. Every read verifies the signature again, so the
stored copy cannot be edited in place. Justflows also refuses:

- a feed with an invalid signature or malformed content;
- a feed older than the one already stored, so an old feed cannot hide an
  advisory;
- an expired feed, which is reported as stale rather than clear.

## Publishing the feed

Maintainers write advisories as a JSON array:

```json
[
  {
    "id": "JF-2026-001",
    "severity": "high",
    "title": "Short description without exploit details",
    "url": "https://github.com/JustFlows/justflows-ce/security/advisories/GHSA-example",
    "type": "plugin",
    "packageId": "acme.forms",
    "ranges": [{ "introduced": "1.0.0", "fixed": "1.2.0" }],
    "revoked": false
  }
]
```

Use `"type": "core"` with `"packageId": "justflows"` for core. `introduced` is
inclusive and `fixed` is exclusive. Either can be `null`: no lower bound, or no fix
yet. `severity` is `low`, `medium`, `high`, or `critical`.

Sign it with a sequence number higher than the last one:

```sh
JUSTFLOWS_CORE_RELEASE_KEY_FILE=/path/to/key.pem \
  node scripts/sign-advisories.mjs advisories.json feed.json --sequence 12 --days 30
```

Place `feed.json` at the path in `SECURITY_ADVISORIES_FILE` on the API gateway.

Re-sign and publish before the feed expires, even when nothing has changed.
Installations report an expired feed as stale. An empty array is valid, and it is
how a clean feed is published.
