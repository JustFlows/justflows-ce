# Trash and retention

Justflows uses recoverable deletion for site-owned content, including built-in
and custom content types, media, comments, and menus. Deleting one of these
resources moves it to **Admin → Content → Trash**. Trashed resources are not
returned by default admin or public API queries and cannot appear on the public
site, feeds, search results, or sitemap.

Content revisions, taxonomy terms, relationships, and menu item documents stay
attached while an item is in trash. Restore also reinstates the content or
comment's pre-trash status. A content or menu slug is released at trash
time so a new resource may reuse it. Restore returns the original slug when it
is available and responds with `409 Conflict` when an active resource now owns
that slug; the collision must be resolved explicitly before retrying.

## Retention and permanent deletion

Administrators configure the retention window under **Admin → Settings → Trash
retention**. The default is 30 days (minimum 1, maximum 3650). A per-site daily
job permanently deletes expired rows. **Empty trash** and individual **Delete
permanently** actions are administrator-only; editors may list and restore.

Media files move to a non-public storage area while trashed and return to their
original path when restored. They still participate in reference checks.
Permanent deletion returns a conflict when the media URL or storage key
is referenced by content fields, block documents, or menus. The administrator
must acknowledge that warning before the row and stored file are removed.

Trash, restore, purge, and empty-trash operations are written to the audit log.
All APIs are scoped to the signed-in user's site:

- `GET /api/trash`
- `POST /api/trash/restore` (up to 200 selected items)
- `DELETE /api/trash/bulk` (up to 200 selected items)
- `POST /api/trash/:type/:id/restore`
- `DELETE /api/trash/:type/:id`
- `DELETE /api/trash`

Permanent media deletion accepts `?confirmReferenced=true` only after the UI
has shown the reference warning.
