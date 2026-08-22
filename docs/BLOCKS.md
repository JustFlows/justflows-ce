# Blocks

Plugins register blocks on `activate`:

```ts
ctx.blocks.register({
  type: "acme.cta",
  version: 1,
  title: "Call to action",
  category: "content",
  schema: {
    heading: { type: "string", required: true },
    href: { type: "string" },
  },
  render(props) {
    const heading = String(props.heading ?? "");
    const href = String(props.href ?? "#");
    return `<a class="acme-cta" href="${href}">${heading}</a>`;
  },
  validateProps(raw) {
    const props = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
      heading: String(props.heading ?? ""),
      href: String(props.href ?? "#"),
    };
  },
});
```

`type` should be namespaced (`acme.cta`). Output goes through the platform
sanitizer — do not emit raw script tags. The editor catalog lists registered
blocks; public HTML is produced on the server, not in the admin SPA.
