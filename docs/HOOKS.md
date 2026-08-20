# Hooks

Hooks are how you change what Justflows does without changing Justflows itself.

If you have used WordPress, the idea is familiar: core announces that something
is happening, and your code gets a turn. The differences are that Justflows
hooks are typed, asynchronous, cancellable where it matters, and clean up after
themselves.

---

## The three kinds

Everything is one of three things. Pick by asking what you want to *do*.

| I want to…                                     | Use a…     | Hook names look like |
| ---------------------------------------------- | ---------- | -------------------- |
| React to something that already happened        | **action** | `content.published`  |
| Stop something before it happens                | **gate**   | `content.beforeCreate` |
| Change a value on its way through               | **filter** | `content.render`     |

The naming tells you which is which. Past tense (`content.created`) is an
action. A `before` prefix (`media.beforeUpload`) is a gate. Everything else is
a filter.

---

## Your first hook

Create the plugin as a folder under `plugins/` (copy `plugins/hello-world`).
A plugin registers hooks in `activate()`. That is the whole setup.

```ts
import type { PluginModule } from "@justflows/sdk";

const plugin: PluginModule = {
  manifest: {
    id: "acme.welcome",
    name: "Acme Welcome",
    version: "1.0.0",
    license: "GPL-2.0-or-later",
    permissions: [],
    main: "index.js",
  },

  activate(ctx) {
    ctx.hooks.action("content.published", (event) => {
      ctx.logger.info("Something was published", { contentId: event.contentId });
    });
  },
};

export default plugin;
```

That is a complete, working plugin. You do not need to unregister anything —
see [Cleanup](#cleanup).

---

## Actions

Actions observe. They cannot change the outcome and cannot stop anything.

```ts
ctx.hooks.action("content.published", async (event) => {
  await searchIndex.add(event.contentId);
});
```

Your handler can be synchronous or `async`. Core waits for async handlers
before running the next one, so ordering is predictable.

**Actions cannot fail the operation.** If your handler throws, Justflows logs
it against your plugin and carries on with the next handler. The content stays
published. This is deliberate: a broken analytics plugin must not break
publishing.

**Treat the payload as read-only.** Mutating the event object to influence core
does not work. If you want to change a value, you want a filter.

---

## Gates

Gates run *before* an operation commits, and can stop it.

```ts
ctx.hooks.gate("media.beforeUpload", (event) => {
  if (event.sizeBytes > 10_000_000) {
    event.cancel("Files must be under 10 MB on your current plan.");
  }
});
```

Calling `event.cancel(reason)` aborts the operation. The upload never happens,
and the caller gets a `HookAbortError` carrying your reason and your plugin ID.

**Write the reason for a human.** It is shown to the end user, so
`"Files must be under 10 MB"` is right and `"ERR_SIZE_LIMIT"` is not.

**Gates fail closed.** If your gate handler throws instead of cancelling, the
operation is *also* aborted, attributed to your plugin. A validation plugin
that crashes must never let bad data through — so a crash is treated as a
rejection, not as permission.

Gates run in priority order and stop at the first cancellation, so later gates
do not run once one has rejected.

Async gates work as you would expect:

```ts
ctx.hooks.gate("content.beforePublish", async (event) => {
  const approved = await legalReview.check(event.contentId);
  if (!approved) event.cancel("Awaiting legal approval.");
});
```

---

## Filters

Filters transform a value. Each handler receives the previous handler's output
and returns the next value.

```ts
ctx.hooks.filter("content.render", (html, context) => {
  return html.replace(/\bJustflows\b/g, `<strong>Justflows</strong>`);
});
```

**You must return a value.** Forgetting the `return` is the classic filter bug,
and it is caught twice.

On a core hook, TypeScript rejects it outright:

```ts
ctx.hooks.filter("content.render", (html) => { html.trim(); });
//                                 ^ Type 'void' is not assignable to 'string | Promise<string>'
```

On a hook that is *not* in `FilterValueMap` — your own namespaced hooks, or a
plugin written in plain JavaScript — the compiler cannot help, so the runtime
catches it instead: returning `undefined` where the incoming value was defined
keeps the previous value and logs a warning naming your plugin. Your filter is
skipped rather than blanking the page.

If your handler throws, the last good value continues down the pipeline and the
error is logged against you.

Filters receive three arguments:

```ts
ctx.hooks.filter("content.render", (value, filterContext, hookContext) => {
  filterContext.contentId; // what is being filtered
  hookContext.siteId;      // who/where — see below
  return value;
});
```

---

## Priority and ordering

Handlers run in ascending priority. Default is `100`. Lower runs earlier.

```ts
ctx.hooks.filter("content.render", sanitize,  { priority: 10 });  // first
ctx.hooks.filter("content.render", addLinks,  { priority: 100 }); // default
ctx.hooks.filter("content.render", minify,    { priority: 900 }); // last
```

Handlers with equal priority run in registration order, so the result is
deterministic across restarts.

Two ordering rules worth knowing:

- **Registering during a dispatch does not affect the run in progress.** Your
  new handler starts participating from the next dispatch.
- **Unregistering during a dispatch takes effect immediately.** If a handler
  disposes another handler that has not run yet, the disposed one is skipped.

---

## The context argument

Every handler gets a `HookContext` as its last argument:

```ts
interface HookContext {
  siteId?: string;      // which site this concerns
  requestId?: string;   // correlate with logs
  source?: "http" | "job" | "cli" | "system";
  actor?: { userId?: string; role?: string };
}
```

Use it to tell apart a human editing in the admin (`source: "http"`) from a
scheduled job (`source: "job"`):

```ts
ctx.hooks.action("content.published", (event, hookContext) => {
  if (hookContext.source === "job") return; // don't email for scheduled posts
  notifySubscribers(event.contentId);
});
```

The context is correlation data only. It never carries secrets, database
handles, or the raw request object. Capabilities come from `ctx` — your
`PluginContext` — and are gated by your manifest permissions.

---

## Typed hooks

Hook names autocomplete and payloads infer. This is a compile error, not a
runtime surprise:

```ts
ctx.hooks.action("content.published", (event) => {
  event.contentId; // ✅ string
  event.postId;    // ❌ Property 'postId' does not exist
});
```

The contracts live in `@justflows/sdk` as `ActionEventMap`, `GateEventMap` and
`FilterValueMap`. Names that are not in those maps still work — the payload is
just `unknown` — so you can hook something you have no types for.

---

## Publishing your own hooks

Your plugin can expose extension points for *other* plugins. Use `emit` for
actions and `apply` for filters:

```ts
// Let other plugins react
await ctx.hooks.emit("acme.seo.scoreCalculated", { contentId, score });

// Let other plugins adjust a value
const tags = await ctx.hooks.apply("acme.seo.metaTags", defaultTags, { contentId });
```

**You may only emit hooks inside your own namespace.** `acme.seo` can emit
`acme.seo.anything`, but trying to emit `content.published` throws. That keeps
the core namespace impossible to spoof and makes ownership readable from the
name alone.

Publish types for your hooks so consumers get the same inference core gives:

```ts
declare module "@justflows/sdk" {
  interface ActionEventMap {
    "acme.seo.scoreCalculated": { contentId: string; score: number };
  }
  interface FilterValueMap {
    "acme.seo.metaTags": [Record<string, string>, { contentId: string }];
  }
}
```

---

## Permissions

Most hooks are open to any plugin. A few require a declared permission:

| Hook namespace | Required manifest permission |
| -------------- | ---------------------------- |
| `auth.*`       | `auth:hook`                  |
| `user.*`       | `users:read`                 |

```json
{
  "id": "acme.audit",
  "permissions": ["auth:hook"]
}
```

Registering without the permission **fails at activation** with a message
telling you which permission to add. It does not silently do nothing at
runtime — a mis-declared plugin never half-works in production.

---

## Cleanup

Every registration you make through `ctx.hooks` is owned by your plugin and
removed automatically when your plugin deactivates. You do not need to track
anything.

```ts
activate(ctx) {
  ctx.hooks.action("content.published", handler); // cleaned up for you
}
```

If you want to remove a handler *earlier* than deactivation, every registration
returns a dispose function:

```ts
const stop = ctx.hooks.action("content.published", handler);
stop(); // handler is gone; calling stop() again is safe
```

There is also `once`, for handlers that should run one time:

```ts
ctx.hooks.action("app.started", warmCaches, { once: true });

// Shared jf-cache (namespaced):
ctx.cache.remember("expensive", 300, async () => compute());
ctx.hooks.action("cache.revalidated", (event) => {
  // event.trigger, event.objects
});
```

For cache APIs and revalidation configuration see [CACHE.md](./CACHE.md).

---

## When your handler breaks

Justflows assumes extensions have bugs and contains the damage.

| Where            | What happens                                                    |
| ---------------- | --------------------------------------------------------------- |
| Action throws    | Logged against your plugin, remaining handlers still run          |
| Gate throws      | Operation is aborted and attributed to you (fails closed)         |
| Filter throws    | Logged, last good value continues down the pipeline               |
| Filter returns nothing | Previous value kept, warning logged                         |

Three more safety nets run automatically:

- **Circuit breaker.** A handler that throws on 10 consecutive dispatches is
  disabled for the rest of the process and reported. A consistently broken
  plugin stops costing every request.
- **Recursion guard.** Re-entering the same hook more than 32 deep is refused
  and logged instead of blowing the stack.
- **Slow-handler reporting.** A handler taking longer than 250 ms is logged
  with its duration and your plugin ID. A slow site always has a named cause.

Every log line carries `hook`, `pluginId` and `handlerId`, so "which plugin did
this" is never a guess. Give your handlers an `id` to make that even clearer:

```ts
ctx.hooks.action("content.published", reindex, { id: "search-reindex" });
```

---

## Synchronous hooks

Most hooks are async. A few run on render paths that cannot wait — currently
`content.render` and `http.responseHeaders` (see `SYNC_FILTERS` in the SDK).

**On a synchronous hook, your handler must be synchronous.** An `async` handler
there gets skipped and logged, because there is no safe way to wait for it and
substituting a pending promise for the value would be worse.

```ts
// ✅ on a sync filter
ctx.hooks.filter("content.render", (html) => html.trim());

// ❌ skipped with an error — this filter is applied synchronously
ctx.hooks.filter("content.render", async (html) => await rewrite(html));
```

If you need async work on a render path, do it earlier — on `content.output`,
or in a job — and [cache the result](./CACHE.md).

---

## Performance

Hooks are cheap enough that you should not think about them:

| Operation                             | Cost      |
| ------------------------------------- | --------- |
| Dispatch with no handlers             | 0.011 µs  |
| Dispatch with one sync handler        | 0.093 µs  |
| Ten-handler synchronous filter        | 0.471 µs  |

A hook nobody listens to costs a map lookup. Synchronous handlers never add a
microtask — the dispatcher only awaits when a handler actually returns a
promise.

The one thing that *is* expensive is work you do inside a handler. If building
the payload for your own hook is costly, check whether anyone is listening
first:

```ts
if (ctx.hooks.has("acme.seo.metaTags")) {
  const tags = await buildExpensiveTags();
  await ctx.hooks.apply("acme.seo.metaTags", tags, { contentId });
}
```

---

## Debugging

From core (or an admin screen), you can inspect what is registered:

```ts
app.hooks.inspect("content.published");
// [{ hook, kind, pluginId, handlerId, priority, runs, errors, totalMs, disabled }]

app.hooks.count("content.published"); // live handlers
app.hooks.didAction("content.published"); // dispatches so far this process
app.hooks.has("content.published");
```

`inspect()` reports per-handler run counts, error counts and total time, which
makes both correctness and performance attributable to a specific extension.

---

## Core hook reference

### Actions

| Hook | Payload |
| ---- | ------- |
| `app.starting` / `app.started` | `{ version }` |
| `app.stopping` | `{}` |
| `content.created` / `updated` / `deleted` | `{ contentId, siteId }` |
| `content.published` / `unpublished` | `{ contentId, siteId }` |
| `media.uploaded` | `{ siteId, mediaId, url }` |
| `media.deleted` | `{ siteId, mediaId }` |
| `user.created` / `updated` / `deleted` | `{ userId }` |
| `auth.login` / `auth.logout` | `{ userId, email }` |
| `auth.loginFailed` | `{ email, reason }` |
| `plugin.installed` / `activated` / `deactivated` / `uninstalled` | `{ pluginId, version, siteId? }` |
| `theme.installed` / `theme.activated` | `{ themeId, version, siteId? }` |
| `request.before` | `{ method, path }` |
| `request.after` | `{ method, path, statusCode, durationMs }` |

### Gates

| Hook | Payload |
| ---- | ------- |
| `content.beforeCreate` | `{ input: ContentDraft }` |
| `content.beforeUpdate` / `beforeDelete` / `beforePublish` | `{ contentId, siteId }` |
| `media.beforeUpload` | `{ siteId, filename, mimeType, sizeBytes }` |
| `media.beforeDelete` | `{ siteId, mediaId }` |

### Filters

| Hook | Value | Context |
| ---- | ----- | ------- |
| `content.input` | `Record<string, unknown>` | `{ siteId }` |
| `content.output` | `Record<string, unknown>` | `{ siteId }` |
| `content.render` | `string` (HTML) | `{ siteId, contentId }` |
| `media.metadata` | `Record<string, unknown>` | `{ siteId, mediaId }` |
| `navigation.items` | `NavigationItem[]` | `{ siteId, location }` |
| `http.responseHeaders` | `Record<string, string>` | `{ method, path }` |

---

## Common mistakes

**Forgetting to return from a filter.** TypeScript catches this on core hooks.
On your own hooks it slips through to runtime, where the previous value is kept
and a warning is logged — nothing breaks, but your filter silently does nothing.

```ts
ctx.hooks.filter("content.render", (html) => { html.trim(); });        // ❌
ctx.hooks.filter("content.render", (html) => html.trim());             // ✅
```

**Using an action where you meant a gate.** `content.created` fires after the
content exists. Throwing there does not undo it — use `content.beforeCreate`.

**Mutating the event payload.** Action events are read-only; changing them does
not influence core. Use a filter, which has an actual return value.

**Doing slow work inline.** A handler on `request.before` runs on every request.
Queue a job instead of making a network call.

**Assuming your handler runs last.** Another plugin can register at a higher
priority. If order matters, set an explicit `priority`.

---

## For core developers

Plugins get the scoped facade above. Core dispatches directly through
`HooksRegistry` from `@justflows/core`:

```ts
// Registration
hooks.action(name, handler, { priority?, pluginId?, once?, id? });
hooks.gate(name, handler, options?);
hooks.filter(name, handler, options?);

// Dispatch
await hooks.dispatchAction(name, event, context?);   // never rejects
hooks.dispatchActionSync(name, event, context?);
await hooks.dispatchGate(name, event, context?);     // throws HookAbortError
await hooks.applyFilter(name, value, filterContext, context?);
hooks.applyFilterSync(name, value, filterContext, context?);

// Introspection and lifecycle
hooks.has(name); hooks.count(name); hooks.didAction(name);
hooks.inspect(name?);
hooks.removePlugin(pluginId);
```

Call `dispatchGate` **before** the operation commits and let `HookAbortError`
propagate to the caller — services translate it into a `409`/`422` carrying
`error.reason`. Call `dispatchAction` **after** it commits, and never `await`
it in a way that can fail the request.

Registry behaviour is configurable at construction:

```ts
new HooksRegistry({
  logger,                 // attributed structured logging
  slowHandlerMs: 250,     // 0 disables per-handler timing
  failureThreshold: 10,   // 0 disables the circuit breaker
  maxDepth: 32,           // re-entrancy limit per hook name
  freezeEvents: false,    // freeze action payloads (on outside production)
});
```

Adding a hook to core means adding it to the maps in
`packages/sdk/src/hooks.ts`. Published hook names and payloads are public API
under semantic versioning — see `HOOKS_SPEC.md` for the compatibility rules.

---

## Under-construction page

When a site is unpublished, visitors see the default under-construction page.
Plugins can change that HTML with a **filter** — the same pattern as
`content.render`.

```ts
activate(ctx) {
  ctx.hooks.filter("site.underConstruction.render", (html, { siteTitle, tagline }) => {
    return html.replace(
      "We&rsquo;re building something great",
      `Thanks for your patience — ${siteTitle} launches soon.`,
    );
  }, { id: "custom-headline" });
}
```

The filter receives the rendered HTML and a context object:

| Field        | Type     | Description                          |
| ------------ | -------- | ------------------------------------ |
| `siteId`     | `string` | Current site                         |
| `siteTitle`  | `string` | From theme identity mods             |
| `tagline`    | `string` | From theme identity mods             |

Handlers must be **synchronous** — this runs on the HTTP render path. Return
the full HTML string; you can replace the entire page if you want.

To react after the page is shown (analytics, logging), listen on the action:

```ts
ctx.hooks.action("site.underConstruction.viewed", (event) => {
  ctx.logger.info("Under-construction page viewed", { siteId: event.siteId });
});
```

**Theme vs plugin:** themes customize presentation through Customizer mods
(`siteTitle`, `tagline`, colors). Plugins customize markup and behavior through
hooks. Keep server logic in plugins, presentation defaults in themes.

---

## See also

- `HOOKS_SPEC.md` — the normative specification and compatibility contract
- `packages/core/src/hooks/registry.ts` — the implementation
- `packages/sdk/src/hooks.ts` — typed hook contracts
- `packages/core/src/__tests__/hooks.test.ts` — behaviour, exhaustively
