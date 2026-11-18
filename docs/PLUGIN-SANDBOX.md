# Plugin sandbox

**Status:** experimental and **off by default**
([#270](https://github.com/JustFlows/justflows-ce/issues/270)). The server part
is done: an unverified plugin's server code can run in its own locked-down
process. Two ways in are still open, so this is **not yet a complete
sandbox**:

- **Admin apps.** A plugin's admin app still runs in a frame on the admin's own
  origin, with the admin session.
- **Public output.** A plugin's filters can still add scripts and HTML to pages
  served on the site's origin.

Until both are closed and the independent review
([#269](https://github.com/JustFlows/justflows-ce/issues/269)) has covered them,
treat every plugin as trusted code, as [extension trust](EXTENSION-TRUST.md)
says. Do not describe this to users as a sandbox.

## Turning it on

Set `JF_PLUGIN_SANDBOX=on` in `.env` and restart. Then every plugin whose
[trust state](EXTENSION-TRUST.md#plugin-trust-states) is **Unverified** runs in
the sandbox. Verified releases, builds you trusted, and plugins with legacy
trust run in the server process as before. **Plugins** shows "Runs in the plugin
sandbox" next to each one.

The sandbox needs Node.js 25 or later, because only then can Node's permission
model block network access. On an older Node.js, an unverified plugin is
**not loaded at all** while the sandbox is on. It never falls back to full
access.

## What the boundary enforces

Each plugin gets one process **per site**, started when that site first needs
it. A plugin on one site cannot see another site's data, even in memory. Node
enforces these limits, not plugin-side code:

| The plugin process cannot | Because |
| --- | --- |
| Read environment secrets (`APP_SECRET`, database credentials) | It starts with an empty environment (`NODE_ENV` only) |
| Read files outside its own folder, such as `.env`, other plugins or core | `--permission` with read access only to its folder, the worker and the SDK |
| Write any file | No write permission |
| Open network connections, including to the database, DNS or Unix sockets | No network permission (Node 25+) |
| Start processes or worker threads, load native addons, use the inspector | Not permitted |
| Import host code or other packages | Only `@justflows/sdk` (and `zod`, which the SDK uses) resolve by name |
| Read the admin session | The host never sends it; request headers have `cookie` and `authorization` removed |

The host also limits each process:

| Limit | Default |
| --- | --- |
| Memory (V8 heap) | 128 MB |
| Hook or filter call | 2 s |
| HTTP route | 15 s |
| `activate`, `deactivate`, `provision`, `deleteData` | 30 s |
| Calls running at once | 16 (more are refused, not queued) |
| Idle process | stopped after 10 minutes |

A handler that runs past its limit stops the whole process, because it may be
stuck in a loop. The next call starts a fresh process. A crash or out-of-memory
error only fails the calls that process was running. After 5 failures within 10
minutes, the plugin's sandbox stops and the failure appears in
**Diagnostics**.

For more defence in depth on a production host, also run Justflows in a
container or under a restricted system account. See
[self-hosting security](SELF-HOSTING-SECURITY.md). Shared hosting without
containers gets the same process boundary.

## What a sandboxed plugin can use

`ctx` calls are messages to the host. The host carries each one out on its own
`ctx` for that plugin, in the request that invoked the handler. So manifest
permissions and site scope apply exactly as for any plugin, and only for the
process's own site.

| `ctx` | In the sandbox |
| --- | --- |
| `pluginId`, `version`, `runtime`, `permissions`, `logger` | Yes |
| `settings` | Yes |
| `data` | Yes, except `transaction` |
| `cache` | Yes. `remember` has no in-flight deduplication |
| `secrets` | Yes, this plugin's own |
| `hooks.action`, `hooks.filter`, `hooks.gate` | Yes, registered during `activate()` |
| `hooks.emit`, `hooks.apply`, `hooks.check` | Yes, own namespace only |
| `hooks.has` | Always `true` |
| `http.get/post/put/patch/delete`, `http.url` | Yes, registered during `activate()` |
| `outbound`, `network` | Absent |
| `jobs`, `mail`, `users`, `roles`, `capabilities`, `content`, `files`, `databases`, `tenancy`, `quotas`, `blocks`, `diagnostics`, `ai`, `captcha`, `cookies`, `patterns`, `i18n` and the rest | Not available. Using them throws |

A plugin that needs something marked "not available" has to be verified to run
outside the sandbox, until that part can be brokered safely.

Notes for plugin authors:

- Register every hook and route inside `activate()`, the same way on every
  site. The host matches handlers by the order they were registered in, and
  refuses a site whose plugin registered something different.
- Values cross the boundary as JSON. Functions are dropped and dates become
  strings. A gate handler gets an `event.cancel(reason)` that works as usual.
- A response `body` may be a string, JSON or a `Buffer`.
- `console` output appears in the server log, prefixed with the plugin id and
  capped in size.

## Testing

`tests/integration/plugins/sandbox-isolation.test.ts` runs a hostile plugin
(`tests/fixtures/sandbox/hostile`). It tries to read secrets and files, write
files, reach the database port and the network, start processes and workers,
import host code, and use namespaces it is not given. Every attempt must be
denied. The same suite checks the time, memory, concurrency and crash limits.
CI runs it on Node.js 26. On an older Node.js the suite is skipped and only
checks that sandboxing reports itself unavailable.
