# Backup and recovery

A backup only counts once you have restored it. This guide covers what Justflows
backs up, what you must protect yourself, and how to prove that a restore works.

Create, schedule, validate, and restore backups in **Admin → Tools**. Only
administrators can do this.

## What a backup holds

A `.jfbackup` file is a complete snapshot of a site at the moment it was made:

- Every site table: content, revisions, terms, menus, media records, comments,
  settings, languages, templates and designs, redirects, roles, accounts with
  their password hashes and passkeys, API keys, webhooks, OAuth clients and
  grants, email templates, search data, the audit log, and data requests.
- Plugins: which plugins are installed and active, each plugin's stored data
  and settings, and the rows of every table a plugin owns. A plugin that keeps
  its rows in a database of its own is read from that database.
- Files: original media (including media in the trash), private files that
  plugins store, and the site's own themes ("Save as new theme").
- Packages: the original, verified archive of every plugin, theme, and CSS
  provider installed from the marketplace or by upload. A package several sites
  use is stored once.
- Secrets: credentials the database keeps encrypted with this installation's
  `APP_SECRET`. They are decrypted into the backup and re-encrypted for the
  installation that restores it.

On the installation root, the backup scope can also be **Root site and all
subsites (one file)**. That network backup also holds the site hierarchy, each
site's addresses, each subsite's database connection, the workspace name and
user mode, the platform settings, and the platform operators. A network backup
is limited to 100 subsites and 512 MB. Automatic backups can use the same scope.

What a backup leaves out on purpose:

- Short-lived state that belongs to the running installation: sign-in sessions,
  password-reset links, passkey challenges, OAuth codes and access tokens (OAuth
  clients refresh through their grant), queued jobs, and locks.
- The backup schedule, so a restored copy never starts sending backups to the
  source's destinations.
- `.env` and the files outside Justflows' control. Keep them in a secret store.
- Bundled plugins and themes that ship with Justflows itself. Restore on the
  same or a newer Justflows version.

A package installed before Justflows kept package archives is fetched once
more from the marketplace when you back up, and only accepted when it matches
the digest recorded at install. An uploaded package from before that time
stops the backup with a message: reinstall it once, then back up again.

## Protect your archives

- **Passphrase.** Every backup is encrypted with AES-256-GCM using a passphrase
  of at least 12 characters, because it holds passwords, keys, and all site data.
  Keep the passphrase in a password manager. Without it, a backup cannot be
  restored, and nobody can recover it. Automatic backups use a passphrase stored
  on the server, encrypted with `APP_SECRET`.
- **Access.** Restrict the destination to the people and systems that need it.
- **Off-host copies.** A backup on the same host fails with that host. Use an
  external destination, ideally with a different provider.
- **Retention.** Justflows does not delete old backups at a destination. Set a
  lifecycle rule there. Keep copies old enough to predate a compromise you might
  discover late.

Backups made by Justflows 0.4 are not encrypted. They still restore, but only
their content, settings, and media.

## How a restore works

Restore validates the whole file first: the passphrase, every checksum, and
every package. Then it saves a snapshot of the target, so anything that fails
later puts the target back as it was.

1. Packages are installed through the same trust checks as an upload: a
   marketplace signature, a pinned digest, or `JUSTFLOWS_ALLOW_UNSIGNED_PACKAGES`.
   A package the installation does not trust stops the restore before any site
   data changes. An identical package that is already installed is reused.
2. Site data is replaced in one transaction. Records get new ids when the
   backup comes from another site, and references to them follow, including
   inside content blocks and media paths.
3. Files are written. Private files go to this server's private storage first.
   When the restored settings name an external bucket, the private-files job
   then copies them there, as it does after any storage change.
4. Plugins that were active are started the same way the server starts them,
   which creates their tables. Then their rows are restored.

The administrator running the restore keeps their account and session. An
account in the backup with the same email address is merged into it. Every
other account comes back with its password, passkeys, and two-factor settings.

Restores run as jobs. Any server process can report their progress or cancel
them. If the process running a restore stops, the next process puts the site
back from the stored snapshot and removes the subsites it created.

## Restore a whole network

A network backup restores onto a clean installation: a root site with no
subsites. Restoring subsites needs multisite on (`JF_MULTISITE=true`) and a
platform operator.

1. In **Admin → Tools** on the root site, enter the passphrase and validate the
   network file. Validation shows each site with its records, accounts, media,
   and plugin data, and the packages it will install.
2. Review each subsite's addresses. They start as the addresses in the backup.
   Change them when this installation uses other addresses, for example in a
   drill. Each address must be free on this installation. The root site keeps
   this installation's address; its other addresses from the backup can be
   added. Custom domains come back pending and are only served after the usual
   DNS check.
3. Choose each subsite's database: the workspace database, the separate
   database from the backup, or another one. Do the same for plugins that keep
   their rows in a database of their own. Every connection is tested before
   anything changes.
4. Type `RESTORE NETWORK` and restore.

The root site is restored first, because subsites can only use a plugin after
the root has created its tables. Subsites are created offline and go live only
after every site is restored. If a step fails or you cancel, the new subsites
are removed, and the root site and the installation settings are put back. The
restore is recorded in the audit log as `backup.network_restored`, with a
failure outcome when it does not finish.

## Set recovery objectives

Write down two numbers for each site, and check that your setup meets them:

- **Recovery point objective:** how much recent data you can afford to lose. Your
  backup schedule sets the best case. A daily backup can lose up to a day.
- **Recovery time objective:** how long the site can be down. Measure this in a
  restore drill, because it depends on your archive size and your host.

## Run a restore drill

Repeat this after major upgrades and at least as often as your objectives need.
Never run a drill against production.

1. Create a clean Justflows installation on an isolated host, with its own
   database and storage. Use a host that cannot send mail or call production
   services: a backup restores the source's mail, storage, and provider
   settings.
2. Use a copy of a recent backup from the real destination, not a fresh download.
   If the backup holds real personal data, treat the drill host as production
   data storage, or use a site with synthetic data.
3. Note the start time.
4. In **Admin → Tools**, enter the passphrase and validate the archive. Compare
   the reported counts with what you expect.
5. Restore it, and type the confirmation phrase. For a network, enter drill
   addresses for the subsites.
6. Check that pages render, media loads, plugins work, and you can sign in.
7. Run the [verification checklist](SELF-HOSTING-SECURITY.md#verification-checklist).
8. Record the date, the backup used, the time taken, and any problems. Compare the
   time with your recovery time objective.
9. Delete the drill installation and its data.

## Backup readiness in the Security Center

**Admin → Security** reports what it can see about automatic backups on the
installation root. It warns when the last backup failed or when a schedule has
stopped running. It never reports a pass, because a finished backup does not
prove that a restore works. Subsites show as unknown, because schedules live on
the root.
