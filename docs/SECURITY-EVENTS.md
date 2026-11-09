# Security event lifecycle

Security events are stored in the local site database and are visible only to
site administrators. The Security Center can export at most 5,000 events at a
time. Exports omit free-form detail, targets, user agents, raw email addresses,
and full IP addresses.

The default retention window is 365 days. Operators can set
`JF_AUDIT_RETENTION_DAYS` and apply it from Admin → Security → Audit log. Each
site is also capped at 100,000 rows by default; `JF_AUDIT_MAX_ROWS_PER_SITE`
accepts values from 1,000 through 1,000,000. Once the cap is reached, the
oldest rows are removed first.

Deleting security events requires the exact confirmation phrase shown in the
administrator. Deletion affects only the selected site and leaves a new audit
marker containing the number removed, not their contents.

Local audit records are not tamper-proof against an attacker who controls the
application host or database. Export important evidence before remediation and
store it separately. Justflows CE does not currently claim or configure an
external security-event sink; the service boundary leaves room for a future
authenticated integration.
