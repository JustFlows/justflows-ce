# 04 — Theme License Policy

**Applies to:** All presentation packages registered as Justflows themes via `justflows-theme.json`.

**Version:** 3.0

---

## Overview

Justflows **core is MIT**. Themes are **not** automatically MIT.

Themes that integrate with Justflows templates, patterns, and theme APIs are
separately licensed packages. Each theme declares its license in the manifest.

> **Themes declare their own license. Official Marketplace listings and
> installed packages must use a GPL-compatible SPDX identifier (GPL, MIT, BSD, ISC, and similar).
> They are not MIT just because core is MIT.**

You may **charge money** for themes. Closed-source themes cannot be listed on
the official Marketplace.

---

## Allowed licenses

| License | Official Marketplace? |
|---|---|
| **GPL-2.0-or-later** | Yes (common) |
| **GPL-3.0-or-later** | Yes |
| **MIT** | Yes |
| **ISC / BSD-2-Clause / BSD-3-Clause** | Yes |
| **Proprietary / closed source** | **No** (Marketplace) |

---

## Requirements for all themes

Every theme **must**:

1. Use the documented theme API and manifest schema
2. Ship a valid `justflows-theme.json`
3. Declare a license
4. Keep presentation logic in theme layer (server logic belongs in plugins)

Marketplace listings **must** also:

5. Use a **GPL-compatible** license
6. Provide source to recipients as that license requires

Every theme **must not**:

1. Modify Justflows Core files
2. Include server-side code that bypasses the plugin system
3. Bundle assets without redistribution rights

---

## Paid themes (allowed)

Same commercial model as plugins:

- Charge for theme, updates, support, or premium designs
- Marketplace-listed theme code must remain **GPL-compatible**
- Recipients receive the rights of the declared license

---

## Distribution channels

### A. Justflows Marketplace

- **GPL-compatible only**
- Security and quality review
- Signed packages
- Paid themes via Justflows Payments

### B. Private sideload

- Theme keeps the license declared in its manifest (must be GPL-compatible)
- Administrator responsibility for unsigned installs

### C. Bundled default theme

`themes/default/` is **GPL-2.0-or-later**, separately from MIT core.

---

## Theme manifest — license field

```json
{
  "schemaVersion": 1,
  "id": "acme.studio",
  "name": "Acme Studio",
  "version": "1.0.0",
  "publisher": "acme",
  "license": "GPL-2.0-or-later",
  "justflows": ">=1.0.0 <2.0.0",
  "templates": ["home", "page", "post", "archive"],
  "supports": ["patterns", "custom-css"]
}
```

---

## Templates & third-party assets

| Asset type | Obligation |
|---|---|
| Your original CSS/templates | Follow the theme's declared license |
| Third-party fonts | Comply with font license |
| Stock photos in demos | Ensure redistribution rights |
| Code ported from third-party themes | Comply with the source theme license |

---

## Child themes

Child themes are derivative of the parent theme:

- Follow the parent theme license plus your own additions
- Cannot redistribute proprietary parent assets without permission
- Marketplace listings must still be GPL-compatible

---

## Related documents

- [02-sdk-and-public-api.md](./02-sdk-and-public-api.md)
- [05-blocks-and-patterns.md](./05-blocks-and-patterns.md)
- [07-marketplace.md](./07-marketplace.md)
