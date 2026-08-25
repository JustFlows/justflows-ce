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

## Props every block carries

Three props are handled by the platform, not by the block's own `render`, so a
plugin block gets them for free and must not define them itself:

| Prop | Type | Effect |
| --- | --- | --- |
| `animation` | object | Entrance, hover, and press effects |
| `className` | string | Extra classes on the block's root element |
| `css` | string | CSS confined to this block instance |
| `layout` | object | Where the block sits when its parent is a grid |
| `style` | object | Spacing, size, alignment, corners and shadow |

`withBlockChrome` in `@justflows/blocks` applies all three to the HTML a block
returns, on every render path. A block whose `render` emits a single root
element gets them on that element; a fragment is wrapped in a `<div>`.

## Per-block CSS

The page-builder inspector has a **Custom CSS** panel per block. What an editor
types is rewritten so it can only reach that block:

```css
padding: 3rem 1rem;              /* bare declarations apply to the block */
& h2 { font-size: 2.5rem }       /* & is the block itself */
&:hover { background: var(--color-surface) }
@media (max-width: 600px) { & { padding: 1rem } }
```

becomes, for a block with id `abc`:

```css
.jf-b-abc {padding: 3rem 1rem}
.jf-b-abc h2 { font-size: 2.5rem }
.jf-b-abc:hover { background: var(--color-surface) }
@media (max-width: 600px) { .jf-b-abc { padding: 1rem } }
```

Rules are scoped by `scopeBlockCss`:

- A selector containing `&` has it replaced by the block's class.
- A selector without `&` is scoped as a descendant, so `html { display: none }`
  becomes `.jf-b-abc html { … }` and matches nothing.
- `@media`, `@supports`, `@container`, and `@layer` are recursed into.
- `@keyframes` and `@font-face` pass through — they are named, not scoped.
- Any other at-rule is dropped.

`sanitizeBlockCss` runs first, on save and again on render: `@import`,
`url(javascript:…)`, `expression()`, `behavior:`, `-moz-binding`, and anything
that could close the `<style>` element are rejected, after CSS escapes and
comments are resolved. A block over 8 KB of CSS is rejected whole. Rejected CSS
is dropped, not thrown — one bad block must not fail the save of a page.

The CSS ships as a `<style>` element immediately before the block's markup,
which needs `style-src` to permit inline styles. The shipped
Content-Security-Policy default does; a site that tightens it loses per-block
CSS along with every other inline style on the page.

`className` accepts letters, digits, hyphens, and underscores only — at most 12
classes. Use it to hook blocks up to theme-wide Additional CSS.

## Editing a block as JSON

The inspector's **Block JSON** panel edits the selected block directly — type,
version, props, and children. The block keeps its own `id` whatever the JSON
says, because the canvas selection, the undo history, and the block's scoped CSS
all point at it. Children without an `id` are given one.

This is the fastest way to set a prop no inspector field exposes, and the only
way to change a block's `type` in place.

With **nothing** selected the inspector shows the whole page instead — every
block, plus the page's header chrome when the builder is editing one:

```json
{
  "version": 1,
  "header": { "visible": true, "showColorScheme": true, "blocks": [] },
  "blocks": [ … ]
}
```

The draft mirrors the canvas until you type into it, then holds still, so
dragging a block around keeps the JSON current but a half-written edit is never
overwritten. When the canvas has moved on under a draft, the panel says so and
**Discard** loads the canvas version.

Applying preserves the `id` of every block that has one — this edits the page in
place rather than importing it, so scoped CSS and undo history stay pointed at
the same blocks. Only a block pasted in without an `id` gets a fresh one. A bare
array of blocks is accepted as well as a full document.


## The grid

`core.grid` is a CSS Grid container. Placement lives on the **children**, not on
the grid, because a grid item is positioned by its own `grid-column` and
`grid-row`. That means any block type can be placed — there is no cell wrapper
to insert, and a plugin block gets it for free.

```json
{ "type": "core.heading", "props": { "text": "Hi", "layout": { "col": 1, "span": 8, "row": 1 } } }
```

| Key | Meaning | Range |
| --- | --- | --- |
| `col` | 1-based start column | 1 … columns |
| `span` | width in columns | 1 … columns − col + 1 |
| `row` | 1-based row, `0` to flow into the next free cell | 0 … 200 |
| `rowSpan` | height in rows | 1 … 20 |

`parseBlockPlacement` clamps `span` so a block can never spill past the last
column — a spill would add an implicit column and silently narrow every other
row. A placement that is just "full width" is not stored at all, so an ordinary
stacked block carries no extra props and no extra attributes.

`withBlockChrome` emits the placement as custom properties on the block's own
root element, which the theme reads:

```css
.jf-grid { grid-template-columns: repeat(var(--jf-grid-cols, 12), minmax(0, 1fr)); }
.jf-grid > * { grid-column: var(--jf-col, auto) / span var(--jf-span, 12); }
```

### Responsive behaviour

Placement is one set of numbers, not one per breakpoint. Two fixed rules apply
instead:

- **≤ 900px** — explicit columns are dropped and blocks flow, but nothing goes
  below half width (`--jf-span-t`). Rows flow rather than staying pinned to a
  track that no longer matches the new spans.
- **≤ 640px** — every block is full width, in source order.

This is why placement is deliberately *not* per-breakpoint: a two-column layout
authored at desktop width turns into unreadable slivers on a phone, and asking
an editor to maintain three sets of numbers to avoid that trades one problem for
a worse one.

### In the builder

Drag a block's badge to move it on the grid; drag either vertical edge to
resize. The inspector's **Position on the grid** panel takes exact numbers,
which is faster when two blocks need to line up precisely. Column guides appear
while dragging or while the grid is selected.


## Spacing and size

`style` gives every block the same spacing controls, on any block type:

| Key | Values |
| --- | --- |
| `padTop` / `padBottom` / `padX` | `"0"`–`"8"`, a step on the theme's spacing scale |
| `marginTop` / `marginBottom` | the same steps |
| `width` | `narrow`, `content`, `wide`, `full` |
| `minHeight` | 0–100, in `vh` |
| `alignSelf` | `start`, `center`, `end`, `stretch` |
| `textAlign` | `left`, `center`, `right` |
| `radius` | `none`, `sm`, `md`, `lg`, `pill` |
| `shadow` | `none`, `sm`, `md` |

Every value is an allowlisted keyword, never a raw length or colour — these land
in a `style` attribute, so the allowlist *is* the defence. Spacing is emitted as
`var(--space-N)` rather than a resolved length, which is what lets the theme pull
a whole page in at once on a phone by lowering one token.

A width also sets `margin-left/right: auto`, because a max-width says nothing
about where the slack goes.

## Reusable blocks

`core.reusable` is a reference, resolved on the server before rendering
(`resolveReusableBlocks`), not copied at insert time — that is the only reason to
have them: editing the saved block updates every page using it. Resolution is
depth-bounded, so a saved block that references itself is dropped rather than
spinning.

Saved blocks live in the `reusable_blocks` site setting and are stored already
sanitized. `PUT /api/reusable-blocks` revalidates the content cache, since every
page using the block now renders differently.
