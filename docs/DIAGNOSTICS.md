# Diagnostics and debug mode

Admin → System → Diagnostics is restricted to administrators and is never
publicly cacheable. It reports sanitized runtime, database, cache, extension,
hook, job, request-trace, and recent-error information. Support bundles contain
the same previewed data and never include environment values, request bodies,
uploads, credentials, or database contents.

Enable developer debug mode from the page for a four-hour window, or configure
`JF_DEBUG=true` with an ISO timestamp in `JF_DEBUG_EXPIRES_AT`. On production
sites the admin displays a persistent warning. The public debug toolbar is shown
only to authenticated administrators; anonymous callers continue to receive
safe errors without stack traces.

## Test services

The Diagnostics page can run bounded checks for **database**, **cache**,
**jobs**, **email**, and **storage** without exposing credentials or customer
data. The email check sends a real test message to the site's configured admin
address using the transport configured in Settings → Email. The storage check
writes, reads, and deletes a small probe file in the configured uploads
directory (`STORAGE_LOCAL_PATH`, local disk by default) and never touches
existing media.

## Reproduce from the server host

```bash
justflows status
justflows health
justflows cache clear
justflows db migrate
```

Copy these with the "Copy" button on the Diagnostics page, or the block above.
Set `ADMIN_URL` when the admin server is not at `http://localhost:3001`. Copy the
`X-Request-Id` response header when reporting a failing request, then use the
request ID to locate its trace in Admin → System → Diagnostics.

## Publish a plugin health check

Declare `diagnostics:publish` in the plugin manifest, then register a read-only
check during activation:

```ts
const unregister = ctx.diagnostics.register({
  id: "provider",
  label: "Provider connection",
  async run() {
    const configured = await ctx.secrets.has("apiKey");
    return configured
      ? { status: "ok", summary: "Provider credentials are configured" }
      : { status: "warning", summary: "Provider credentials are not configured" };
  },
});
```

Check IDs are namespaced by plugin, execution is time-bounded by the host, and
returned details are recursively redacted before display or export. Checks must
not return credentials, personal data, raw provider responses, or another
plugin's data. Registrations are removed automatically when the plugin is
deactivated; the returned function supports earlier cleanup.
