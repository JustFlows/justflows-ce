# Incident response

Use this guide when you suspect that a Justflows site, administrator account,
API credential, extension, or host has been compromised. Work through the steps
in order. Record what you did and when, so you can explain the sequence later.

If you think you found a vulnerability in Justflows itself, report it privately
as described in [SECURITY.md](../SECURITY.md). Do not open a public issue.

## 1. Decide what may be affected

Treat the incident as a host compromise until you have evidence that it is not.
Plugins, themes, and core updates run in the same Node.js process as the site,
so an attacker who could install code or reach an administrator session may have
reached the server, its `.env`, and its database. See
[extension trust](EXTENSION-TRUST.md).

Identify the affected sites, accounts, and extensions, and when the activity may
have started. On a multi-site installation, decide whether one site is affected
or the whole installation.

## 2. Preserve evidence

Do this before you change anything. Remediation can overwrite what you need.

- Export security events from **Admin → Security → Audit log** and store the file
  away from the host. One export holds at most 5,000 events and leaves out
  free-form detail, targets, user agents, raw email addresses, and full IP
  addresses. See [security events](SECURITY-EVENTS.md).
- Take a host-level snapshot of the database and the application directory if
  your provider supports it.
- Copy web server, proxy, and edge logs. Providers often keep them for a limited
  time.

Local audit records are not tamper-proof against someone who controls the host
or database. Compare them with logs kept elsewhere.

Evidence can hold personal data and credentials. Restrict who can read it, and
remove secrets, tokens, and customer data before you share it with anyone
outside the response.

## 3. Contain access

Choose the steps that match what you found in step 1.

| Exposure                | Action                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One account             | Set a new password in **Admin → Users**. This revokes every session the account has. Without admin access, run `justflows user reset-password --email <address>` from the install directory. |
| A user's other devices  | The user can revoke one device or all other devices from Account Security.                                                                                                                   |
| API keys                | Revoke or rotate the key in **Admin → Settings → API keys**. Check the list for keys you do not recognize.                                                                                   |
| Every signed session    | Rotate `APP_SECRET`. This also affects encrypted settings, so follow [secrets and rotation](SELF-HOSTING-SECURITY.md#secrets-and-rotation) first.                                            |
| A suspicious extension  | Deactivate it in **Admin → Plugins**, or run `justflows plugin deactivate <id>`. Deactivating stops new execution. It does not undo what the code already did.                               |
| A host you cannot trust | Take the site offline at the proxy, edge, or firewall, and rebuild on a clean host. Do not clean a compromised host in place.                                                                |

Review administrator accounts, roles, and recent privilege changes, and remove
anything you cannot explain.

## 4. Reinstall from trusted releases

Do not repair modified files by hand.

- Check **Admin → Security → File integrity**. An extension that no longer matches
  its baseline is not loaded.
- Reinstall modified extensions from a trusted package. There is no control that
  adopts the current files as a new baseline.
- Use **Force reinstall** in **Admin → Updates** to replace core with a signed
  release, then run `node scripts/verify-core-integrity.mjs`.
- An installation with no manifest or baseline reports as unverified. That is
  not proof the files are clean.

File integrity does not cover uploads, storage, secrets, themes, or plugins in
the core manifest. Check those separately. A clean integrity result does not
prove that a host is uncompromised.

## 5. Rotate secrets

Assume anything the application could read is exposed if the host or an extension
was compromised. Rotate database, SMTP, IMAP, storage, registry, signing,
AI-provider, and payment credentials at each provider, then update every worker.
Follow the order in
[secrets and rotation](SELF-HOSTING-SECURITY.md#secrets-and-rotation).

## 6. Restore and validate

Choose a backup from before the first suspicious activity. A later backup may
contain the attacker's changes.

Validate the archive in **Admin → Tools** before you restore it. Restore requires
a clean target. It keeps the target's administrator and secrets, so credentials
are not brought back from the archive. Backups list plugins and themes as an
inventory, so install those from trusted packages.

Rehearse this on an isolated installation with synthetic data before you need
it. Creating a backup does not prove that you can recover from it.

Before you reopen the site, work through the
[verification checklist](SELF-HOSTING-SECURITY.md#verification-checklist).

## 7. Notify and follow up

- Tell affected operators, site owners, and users what happened, what data was
  involved, and what they need to do.
- Check your legal notification duties and deadlines. Justflows provides the
  mechanisms, but the operator is the data controller and makes these decisions.
- Keep watching the audit log and host logs after you reopen the site.
- Record the cause, the timeline, and what will change, then fix the gap that
  allowed the incident.
