# Multi-site and multi-tenant hosting

One Justflows installation can serve many sites. A **workspace** (tenant) owns one or more sites. Each site is reached by its own hostname. An unknown host is refused. It is never served as another workspace's site.

## Database choice

Every workspace chooses where its data lives:

| Choice | What it means |
| --- | --- |
| **Current database** | Content, users, media metadata, settings, themes, and plugin activation stay in the installation database. Rows are scoped by site. |
| **Separate database** | The workspace gets its own database. The installation database keeps only routing: the workspace, the hostname, and the encrypted connection. Tenant administrators never receive that password. |

A site can stay on the workspace database, stay on the current database, or get its own separate database. A dedicated database per site is that last option. Shared users cannot split across databases: either every site in the workspace uses the same database, or the workspace uses isolated users.

The connection uses the same driver as the installation (PostgreSQL, MySQL, or MariaDB). Credentials are encrypted with the installation secret. Platform → reveal writes an audit row and is limited to platform operators.

Creating the database uses the account you enter. That account needs permission to connect, and to `CREATE DATABASE` when the database does not exist yet. A failure is stored on that workspace only.

## Users

- **Isolated users.** Each site has its own accounts. The same email can exist on another site and is a different person.
- **Shared users.** One account in the workspace, with a role on each site. Signing in on a site uses that site's role. The session cookie is for that host only. Opening another site does not reuse it.

The first administrator created by the installer is a **platform operator**. Platform operators manage workspaces, suspension, and database placement. A person who signs up for a site is only an administrator of that site.

Updates, diagnostics, and the server cache live on the installation's first site. A site created later does not show those pages, and its API calls for them are refused. Platform stays with the platform operator. Content, media, themes, plugins, users, and the site's own settings stay on every site.

## Hosts, DNS, and TLS

Store the hostname without a scheme or path (`www.example.com`, `my-site.example.com`). Point DNS at this installation. Terminate TLS at the reverse proxy or host. Justflows does not issue certificates.

While the installation has exactly one site, `localhost` still opens that site so an existing install keeps working. After a second site exists, each host must be registered. Add `site-a.localhost` and `site-b.localhost` to your hosts file to try two sites locally.

Signup uses `slug.<base domain>`. Turn it on under Admin → Platform and set the base domain. Visitors do not enter a database connection. The same screen chooses the current database or one separate database for every new signup. The installation keeps the platform site and the routing; the password stays on the platform. The link after signup keeps the scheme and port of the signup page, so a local site opens at `http://my-site.localhost:3000`.

## Operations

Suspending a workspace suspends its sites and leaves every other workspace running.
Migrations on a separate database: Admin → Platform, or `POST /api/platform/databases/:id/migrate`. The installation database is migrated on boot as before.

Backup the installation database for routing and every separate database on its own:

```bash
pg_dump --host HOST --username USER --dbname DATABASE > workspace.sql
mysqldump --host HOST --user USER DATABASE > workspace.sql
```

Restore with `psql` or the `mysql` client into that same database, then run migrations. Deleting a workspace marks it deleted. Dropping its database is a separate confirmation and does not touch other databases. If the drop fails, the error is stored on that connection and other workspaces stay up.

## Files per site

Each site's files sit in a folder of their own, so one site can be backed up,
moved, or removed without touching another:

| What | Where |
| --- | --- |
| Media, responsive variants, trash | `uploads/<siteId>/` (or the `<siteId>/` prefix in the S3 bucket — see [Media](MEDIA.md#storage-and-cdn)) |
| Static export | the main site: `static-export/`; every other site: `static-export-sites/<hostname>/` |
| "Save as new theme" forks | `packages-installed/sites/<siteId>/themes/` |

`/uploads` only serves a site's own folder on its own host. A static export run
from a site crawls that site's hostname and publishes under it; the
`STATIC_EXPORT_*` settings in `.env` describe the main site and can only be
changed there. A customer site can turn static export off for itself under
Tools. That does not change the installation, and it leaves files already
exported until that site clears them. Auto-rebuild queues each site separately
and skips a site that turned export off.

Shared by every site: bundled themes and plugins, marketplace packages under
`packages-installed/themes/` and `packages-installed/plugins/`, the cache
folder, and `.env`. Deleting a workspace marks it deleted and leaves these
folders on disk.

## Adopting this on an existing install

Migration `0037_tenancy` creates a Primary workspace on the current database, attaches the existing site, registers the host from the site URL, and makes the earliest administrator a platform operator. Users stay isolated, which matches accounts that already belong to one site. Add another site from Admin → Platform when you are ready. Choose **Current database** or **Separate database** at that moment.

## Plugins

A plugin is installed on the main site. It reaches other sites only when its manifest sets `allowMultisite` to `true` and the main site turns on **Available on other sites**. Another site can activate that plugin. It cannot install a package, and it cannot drop the plugin's tables. Removing the plugin there deletes only that site's rows. The main site can delete the plugin, and drop its tables, once no other site still has it.

A plugin reads the workspace for the current request with `ctx.tenancy.current()`. That object has the workspace id, site id, hostname, user mode, database mode, and whether this is the main site. It never includes a database password.

Creating, listing, suspending, reactivating, and deleting workspaces requires the `platform:tenancy` manifest permission. The same operations are on the management API at `/api/manage/v1/tenants` for an API key whose user is a platform operator.

Gates `workspace.beforeCreate`, `site.beforeCreate`, `workspace.beforeSuspend`, `workspace.beforeReactivate`, and `workspace.beforeDelete` run before the change. Cancel to refuse it. Actions `workspace.created`, `site.created`, `workspace.suspended`, `workspace.reactivated`, and `workspace.deleted` run after it succeeds. See [Hooks](HOOKS.md).

## What Justflows does not operate

DNS, TLS certificates, subscriptions, and outbound email stay with the operator. A plugin can add paid plans. Justflows provisions the database you configure.
