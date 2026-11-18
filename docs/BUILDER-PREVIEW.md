# Builder preview and recovery

The page builder canvas aims to show a page as the public site renders it.
This page says how that is checked, where the canvas deliberately shows
something else, and what happens to a block the builder cannot show or edit.

## How the canvas matches the page

- **Plugin and theme blocks** are rendered by the server with the block's own
  `render` and shown as returned, after a builder-only sanitizer removes
  anything that could run code, load something or cover the builder (see
  [Plugin block previews](#plugin-block-previews)).
- **Core blocks** are drawn by the builder itself, so that text, images and
  links can be edited in place. Before drawing, the builder runs the block's
  own `validateProps` from `@justflows/blocks`, so a missing or invalid setting
  gets the same default as on the page.
- **Styles, presets and responsive values** come from the same functions in
  `@justflows/blocks` on both sides: block style declarations, preset classes
  (`jf-sp-*`) and breakpoint rules. On the canvas, breakpoint rules use a
  container query on the canvas width instead of a media query on the window,
  so the Tablet and Mobile previews work without resizing the browser.
- **Theme styles** load from the same `/theme.css` the page uses, scoped to the
  canvas, in the light or dark scheme picked in the toolbar.

`apps/server/admin-ui/tests/components/builder/preview-parity.test.tsx` renders
every core block with both renderers and compares the elements and classes.
It also compares style declarations, preset classes and breakpoint rules, and
checks that plugin markup keeps its structure. A change to one renderer that
the other does not follow fails this test.

### One renderer for core blocks

Core blocks are moving from the canvas's own React copies to the public
renderer ([#311](https://github.com/JustFlows/justflows-ce/issues/311)). A
moved block is drawn with its own `render` from `@justflows/blocks`, the
function the server calls for the page, run in the browser without a request
(`ServerBlock.tsx`). Selection, the toolbar, drop zones and resize handles
stay around it. Its child blocks are still drawn by the canvas, mounted into
a slot in the block's markup, so they can be selected, edited and dropped on,
and changing the parent's settings does not redraw them. A Column keeps a
minimum height on the canvas so there is room to drop into it.

Every core block is drawn this way, except the labelled stand-ins listed
below. Template blocks (Post title, meta, excerpt, featured image and
content) are not core blocks: the page fills them in per request, so the
builder shows the entry's own title and date or the content itself.

Blocks you edit in place (Heading, Paragraph, Quote, Button, Hero, Call to
action, List item) are marked by the renderer: each field's element carries
`data-jf-inline="<field>"`, as plugin blocks do. While the block is selected,
the canvas mounts the in-place editor inside that element, with the same
toolbar, formulas, input-method handling and Escape as before. While it is
selected the renderer draws its fields with stand-ins, so every field
(also an empty optional one, or a button with no link yet) can be edited and
a commit does not redraw the markup under another open editor. An empty
required field that is not selected shows its placeholder.

Image, Video, Audio and File keep media replacement around the page's
markup: double-click the media or use the Replace button under it (the
keyboard control), and a video's poster has its own buttons. Their caption
and a file's link text are edited in place; an image's alt text, which the
page does not show, is edited beside it.

## Where the canvas deliberately differs

| What | On the canvas | Why |
| --- | --- | --- |
| Links and buttons | Shown, but not followed | Clicking in the builder selects; use Preview to follow links. |
| Forms inside blocks | Not submitted | Same reason. |
| Empty blocks | A short hint in place of the missing text, image or media | So an empty block can still be found and selected. |
| Details | Always open | So its content can be reached and edited. |
| Cover background video | Does not autoplay | So the canvas stays still while you edit. |
| Spacer | A striped fill at its height | The page draws it empty. |
| Site logo, title, tagline, navigation, breadcrumbs | A labelled stand-in | They show site data that the page fills in when it is served. |
| Content query, table of contents | A labelled stand-in | They list content or headings found when the page is served. |
| Search, account, login and register forms, login links, language switcher, colour scheme | A labelled stand-in or neutral state | They depend on the visitor. |
| Embeds | A labelled stand-in | Third-party content is not run in the builder. |
| Grid | The page's grid element, with the grid editor's own tracks and placement handles inside it | So items can be placed and resized. |
| Linked reusable blocks, header, template and footer | Shown read-only with a label | They are edited in their own editor (see [Themes](THEMES.md)). |

A labelled stand-in shows a "Preview" tag on hover or when selected. Its
tooltip says why the block looks different. The list lives in
`apps/server/admin-ui/src/components/builder/preview-substitutions.ts`, and the
parity test fails if a block on it is not labelled.

## Blocks the builder cannot show or edit

A stored block is never changed unless the author changes it. That holds for
each case below, for saves while the block cannot be shown, and for the
public page.

| Situation | Canvas | Block settings | Public page |
| --- | --- | --- | --- |
| Its plugin or theme is switched off | "Unavailable block" with its type | Type, provider, version, id, number of settings and nested blocks; Try again, Copy data, Download data, Manage extensions, Replace with…, Remove block | Left out, with an HTML comment naming the type |
| Deprecated | Its normal preview, with a note naming the replacement | A notice with Replace with… (the replacement is preselected), above its usual settings | Unchanged |
| Its stored version could not be upgraded | Its preview from the stored settings, with a note | Usual settings | Rendered from the stored settings |
| Drawing it on the canvas throws | "could not be shown in the builder", with Try again | Usual settings | Unchanged; a block whose `render` throws is left out on its own |
| Its preview fails, is empty or takes over 8 seconds | Failure, empty or timeout notice, with Try again | Usual settings | Unchanged |

- **Saving keeps everything.** A block whose extension is off keeps its type,
  id, version, settings and nested blocks through every save, and shows again
  unchanged once the extension is active.
- **Try again** loads the list of blocks again, so a block comes back without
  reloading the builder after its extension is switched on.
- **Replace with…** keeps the block's id and editor label, carries over every
  setting the new block also declares, and keeps nested blocks when the new
  block accepts them. It always asks first, and says how many settings and
  nested blocks would be lost.
- **Remove block** always asks first, and says how many nested blocks go with
  it.
- **Copy data** and **Download data** give the stored block as JSON, for
  support or for restoring it later through the JSON panel.

## Plugin block previews

`sanitizePluginPreviewHtml` in `@justflows/blocks` prepares a plugin block's
HTML for the canvas. It keeps:

- structural and text elements, tables, `details`, and simple inline SVG icons
- `class`, `id`, ARIA, `role` and `data-*` attributes
- inline styles for colour, spacing, size, borders, typography and flex or
  grid layout

It removes scripts, frames, embeds, forms and inputs, event handlers, SVG
`use` and `foreignObject`, `javascript:` and protocol-relative links, CSS that
loads anything (`url()`, `image-set()`), and positioning. It is used only for
the builder preview, never for stored or public HTML.
