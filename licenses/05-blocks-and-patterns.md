# 05 — Blocks & Patterns License

**Applies to:** Content blocks, block definitions, and layout patterns.

**Version:** 3.0

---

## Overview

Blocks and patterns inherit licensing from the component they ship with.
Core blocks are MIT with the platform. Plugin and theme blocks follow the
**plugin or theme license**. Marketplace-listed extensions must still be
GPL-compatible.

---

## License by origin

| Origin | License |
|---|---|
| **Core blocks** (`packages/blocks/`, default library) | MIT |
| **Plugin blocks** | Plugin license (Marketplace: GPL-compatible) |
| **Theme patterns** (`patterns/*.json`) | Theme license (Marketplace: GPL-compatible) |
| **User content in database** | User-owned content (not a software license matter) |

---

## Block definitions in plugins

```ts
ctx.blocks.register({
  id: "acme/hero",
  title: "Hero Banner",
});
```

- Block definition code → follows plugin license
- Rendered HTML output on public site → not subject to the software license of the block definition

---

## Patterns

| Location | License |
|---|---|
| `themes/default/patterns/` | GPL-2.0-or-later (bundled theme) |
| Theme `patterns/` | Theme license |
| Plugin patterns | Plugin license |
| Marketplace pattern packs | GPL-compatible |

---

## Related documents

- [03-plugins.md](./03-plugins.md)
- [04-themes.md](./04-themes.md)
