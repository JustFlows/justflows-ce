# Threat model

**Revision 1.** Written against development revision `3207668`, after release 0.4.0.
Update the revision when auth, tenancy, extensions, or update trust change
materially.

This describes who Justflows defends against and where the trust boundaries sit.
It does not claim that any control is free of defects, and it holds no exploit
details. Report vulnerabilities as described in [SECURITY.md](../SECURITY.md).

## Actors

| Actor                 | Trusted to                                  | Must not be able to                                                     |
| --------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| Anonymous visitor     | Read public content and submit public forms | Reach private data, administration, or unbounded server work            |
| Content author        | Work on content their capabilities allow    | Run server code, or raise their own role or capabilities                |
| Site administrator    | Manage one site                             | Read or change another site, or installation-wide state from a subsite  |
| Network operator      | Manage the installation and install code    | Nothing below host level. Treat this role as equal to shell access      |
| API and MCP client    | Act within its key or token scope           | Exceed the scope or capabilities of the identity it acts for            |
| Extension publisher   | Ship signed packages through the registry   | Replace an installed package without a valid signature or pinned digest |
| Compromised extension | Nothing                                     | Contained only by the host account. See below                           |

## Assets

- **Sessions and credentials:** cookies, device sessions, API keys, OAuth tokens,
  MFA secrets, and recovery codes.
- **Secrets:** `APP_SECRET`, database and storage credentials, provider keys, and
  values encrypted with them.
- **Tenant data:** content, media, users, submissions, and plugin data per site.
- **Private storage:** files outside public delivery, update backups, and rollback
  data.
- **Code and release trust:** core, extensions, signing keys, and the update path.
- **Availability:** workers, background jobs, storage quotas, and outbound capacity.

## Trust boundaries

| Boundary                 | Crossing it                                   | Main controls                                                                  |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------ |
| Internet to application  | Every public and API request                  | Authentication, CSRF, input validation, rate limits, trusted proxy settings    |
| Role to role             | A user acting beyond their capabilities       | Server-side capability checks, delegation ceilings                             |
| Site to site             | A request or job touching another tenant      | Tenant-scoped queries and object checks                                        |
| Member to staff          | Staff authentication through member pages     | [Separate sign-in surfaces](AUTH.md)                                           |
| Application to storage   | Uploads, archives, and private files          | Upload admission, contained extraction, path validation, delivery restrictions |
| Application to network   | Outbound requests chosen by users or plugins  | SSRF protection, pinned fetch, redirect handling                               |
| Jobs to tenants          | Background work on behalf of a site           | Site-scoped jobs, quota reservations                                           |
| Registry to installation | Packages and updates arriving from outside    | Signatures, pinned digests, integrity baselines, permission approval           |
| Gateway to installation  | Release and advisory metadata                 | Signed releases and advisory feeds, verified against pinned keys               |
| Extension to host        | Plugin code in the server process             | **None at process level.** See [extension trust](EXTENSION-TRUST.md)           |
| Application to host      | Deployment configuration and file permissions | Operator responsibility. See [secure self-hosting](SELF-HOSTING-SECURITY.md)   |

## Accepted risks

- An extension in the server process can reach everything the application account
  can. Justflows does not offer a sandbox.
- A network operator can run arbitrary code by design.
- Local audit logs are not tamper-proof against someone who controls the host or
  database.
- Application rate limits do not absorb network-level DDoS traffic.
- A host compromise defeats every application-level control.

## Out of scope

Justflows cannot verify firewall policy, certificate validity as seen by every
client, edge cache behavior, off-host backup availability, or host compromise from
inside the process. Operators own those controls.
