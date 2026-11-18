# Backup and recovery

A backup only counts once you have restored it. This guide covers what Justflows
backs up, what you must protect yourself, and how to prove that a restore works.

Create, schedule, validate, and restore backups in **Admin → Tools**. Only
administrators can do this.

## What a backup holds

A `.jfbackup` file is a portable archive of one site's content, design
configuration, and original media, with a plugin and theme inventory. Backups can
go to a download, FTP/FTPS, email, or an S3-compatible bucket.

On the installation root, the backup scope can also be **Root site and all
subsites (one file)**. That network backup holds each site's own checksummed
archive, the site hierarchy, each site's hostnames, and one plugin and theme
inventory that lists a shared package once with the sites that use it. Sites
that use a separate database are read from that database. A network backup is
limited to 100 subsites and 512 MB. Automatic backups can use the same scope.

A backup is not the whole installation:

- It leaves out credentials and environment-specific values, so keep `.env` and
  provider credentials separately in a secret store.
- Plugins and themes are listed but not included. Reinstall them from trusted
  packages.
- A single-site file covers one site. Use a network backup to keep the root site
  and every subsite together.
- User accounts and passwords are not restored. Subsites restored from a network
  backup get the account of the administrator who restored them.

## Protect your archives

- **Encryption.** Justflows encrypts destination credentials, but it does not
  encrypt the archive. A backup holds your content and media in readable form, so
  use encrypted storage at the destination.
- **Access.** Restrict the destination to the people and systems that need it.
  Anyone who can read a backup can read the site's data.
- **Off-host copies.** A backup on the same host fails with that host. Use an
  external destination, ideally with a different provider.
- **Retention.** Justflows does not delete old backups at a destination. Set a
  lifecycle rule there. Keep copies old enough to predate a compromise you might
  discover late.

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
   services.
2. Use a copy of a recent backup from the real destination, not a fresh download.
   If the backup holds real personal data, treat the drill host as production
   data storage, or use a site with synthetic data.
3. Note the start time.
4. Install the plugins and themes from the backup's inventory using trusted
   packages.
5. In **Admin → Tools**, validate the archive. Compare the reported item and media
   counts with what you expect.
6. Restore it. Restore needs a clean target, and you must type the confirmation
   phrase.
7. Check that pages render, media loads, and you can sign in.
8. Run the [verification checklist](SELF-HOSTING-SECURITY.md#verification-checklist).
9. Record the date, the backup used, the time taken, and any problems. Compare the
   time with your recovery time objective.
10. Delete the drill installation and its data.

## Restore a whole network

A network backup restores onto a clean installation: a root site with no
subsites. Restoring subsites needs multisite on (`JF_MULTISITE=true`) and a
platform operator.

1. Install the plugins and themes the validation lists as missing, from trusted
   packages.
2. In **Admin → Tools** on the root site, validate the network file. Validation
   checks every site archive and shows each site with its record and media
   counts before anything changes.
3. Review the address for each subsite. Each field starts with the subsite's
   primary hostname in the backup. Change it when this installation uses other
   addresses, for example in a drill. Each address must be free on this
   installation. The root site keeps this installation's address. Custom
   domains, extra hostnames, and separate database connections are not
   recreated: subsites are created in the workspace's database, and you connect
   domains again under Settings → Domains.
4. Type `RESTORE NETWORK` and restore. The restore shows its progress and can be
   cancelled.

Subsites are created offline and restored first. The root site is restored last
and its restore is transactional. If any step fails or you cancel before the
root site is restored, the new subsites are removed, and the root site is left
as it was. Subsites come online only after every site has been restored. The
restore is recorded in the audit log as `backup.network_restored`, with a
failure outcome when it does not finish.

## Backup readiness in the Security Center

**Admin → Security** reports what it can see about automatic backups on the
installation root. It warns when the last backup failed or when a schedule has
stopped running. It never reports a pass, because a finished backup does not
prove that a restore works. Subsites show as unknown, because schedules live on
the root.
