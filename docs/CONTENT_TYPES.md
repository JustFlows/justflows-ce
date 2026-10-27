# Content type configuration

Administrators configure each type under **Content → Content Types**. Save changes
explicitly after editing settings or fields. Existing types keep their previous
behavior until an override is saved.

| Setting | Behavior |
| --- | --- |
| Label / plural label | The main label names an individual entry; the optional plural label appears in the content type overview. |
| Description | Describes the type in the overview. |
| Content editor | Automatic keeps the existing type/plugin default. Block builder and Custom fields select the editor used for entries. Existing blocks and fields are preserved. Plugins can still override the editor through `content.editor`. |
| Dashboard quick action | Adds a New entry shortcut. Existing page and post shortcuts are enabled by default; other types opt in. |
| Revision history | Enables capture of new historical restore points. Turning it off preserves old history, working drafts, autosave, version checks, and scheduling. |
| Draft previews | Controls staff previews and shareable preview links, including previously issued links. |
| Public search | Inherit site/plugin search configuration, explicitly include, or explicitly exclude the type. Admin search still includes it. |
| SEO metadata and sitemap | Enables the entry editor's SEO settings, their public rendering, and published entries in the core sitemap. Turning this off is not a `noindex` directive or access restriction. |
| Comments | Inherit the site default, enable comments by default, or disable them for the whole type. Disabled wins over an entry's Open override. Existing moderation, CAPTCHA, spam checks, and age limits still apply. |
| Cache-Control | Inherit site policy or set a type policy. Private account and sign-in types remain locked to never cache. |

Account and sign-in types cannot opt into public search, SEO, or comments.

The authenticated content-type endpoints accept a `settings` object on create or
update and return normalized settings on reads. Settings are scoped to the site
and stored in the additive `0050_content_type_settings` migration, with PostgreSQL
and MySQL/MariaDB variants. Normal startup applies pending migrations.

This configuration does not introduce custom per-type URL patterns, edit leases,
relations, or a switch to remove the core draft workflow. URL configuration
continues to use Settings → Permalinks; version conflict checks remain active.
