# Webhooks

Justflows can push content and media lifecycle events to external HTTP services.
Administrators manage endpoints and inspect attempts at **Admin → Webhooks**.

## Events

Core provides `content.published`, `content.unpublished`, `content.deleted`, and
`media.uploaded`. Each endpoint subscribes to one or more events. Delivery is
asynchronous: the originating publish, delete, or upload does not wait for the
receiver.

The JSON body is capped at 256 KiB:

```json
{
  "id": "event UUID",
  "event": "content.published",
  "createdAt": "2026-08-31T12:00:00.000Z",
  "data": { "contentId": "…", "siteId": "…", "type": "page" }
}
```

## Verify a signature

The secret is shown only when an endpoint is created or its secret is rotated.
Store it in the receiver's secret manager. Justflows sends:

- `X-Justflows-Delivery`: the delivery UUID
- `X-Justflows-Timestamp`: Unix time in seconds
- `X-Justflows-Signature`: `sha256=` plus a hex HMAC-SHA256 digest

Build the signed bytes as `<timestamp>.<raw request body>` and calculate the
HMAC with the endpoint secret. Compare digests in constant time and reject old
timestamps (five minutes is a typical replay window). Always verify the raw
body before parsing JSON.

## Retries and history

Non-2xx responses, timeouts, DNS failures, and connection errors retry through
the jobs scheduler with exponential backoff. A delivery is marked failed after
five attempts. Admin → Webhooks retains the latest delivery records, response
status/body excerpt, error, and a manual **Redeliver** control.

Endpoint URLs are checked when saved and immediately before delivery. Local,
private, link-local, multicast, credential-bearing, and non-HTTP(S) targets are
rejected; redirects are not followed. Responses and errors stored in history
are bounded.

## Plugin-defined events

A plugin adds its namespaced action to the selectable event names with
`webhook.eventTypes`. Emitting that action then uses the same persisted webhook
delivery path as core events:

```ts
activate(ctx) {
  ctx.hooks.filter("webhook.eventTypes", (events) => [
    ...events,
    "acme.orders.completed",
  ]);

  await ctx.hooks.emit("acme.orders.completed", { orderId: "order-123" });
}
```

Use a namespaced event name and JSON-serializable, non-secret data. The plugin
runtime adds the current site ID to the hook context when emitting.
