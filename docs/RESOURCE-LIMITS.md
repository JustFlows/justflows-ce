# Resource limits and multiple workers

Justflows uses both database-shared controls and process-local admission limits.
Operators running more than one Node.js worker must size the process-local limits
per worker and enforce request/body and connection ceilings at the reverse proxy.
Application throttling is not upstream DDoS protection; see
[edge protection](EDGE-PROTECTION.md).

## Control matrix

| Resource                                                | Boundary                                | Multiple workers                                                                                 | Shared-store failure                                                               |
| ------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Authentication, public/API, and plugin request counters | Per process and key/IP                  | Effective allowance is multiplied by the worker count                                            | No external store is required; the bounded in-memory map remains available         |
| Multipart upload admission                              | Per process and site                    | `JF_UPLOAD_CONCURRENCY` applies to each worker; proxy body/concurrency caps are required         | Requests remain bounded by the local counter and byte limit                        |
| Media, private-file, and export storage                 | Per site                                | A control-database row lock serializes fresh inventory and reservations across workers           | Finite quotas refuse growth when usage or the lock cannot be read                  |
| Image variant generation                                | Durable job plus per-upload reservation | A database claim lets one worker own a job; storage reservations remain site-scoped              | The run fails and retries with a bound; it does not continue without a reservation |
| Other durable background jobs                           | Database row and lease                  | Conditional claims allow one lease holder; each worker also has a local concurrency ceiling      | Polling returns no work and retries later; enqueue reports the database error      |
| Static export crawl                                     | Per process and export                  | Configured crawl concurrency is bounded to 1–32; a site storage lock prevents concurrent writers | Export fails instead of writing without its storage check                          |

The process-local request counters deliberately do not claim to be a global
rate limit. A shared cache is not required for a supported single-process CE
installation. In a multi-worker deployment, divide the intended installation
allowance between workers where possible and put an installation-wide limit at
the trusted reverse proxy or edge.

## Trusted client addresses

`TRUST_PROXY` accepts `false`, Express named ranges such as `loopback`, or
explicit proxy IP addresses/CIDRs. `true` and numeric hop counts are ignored:
they trust a position in the request path, and a shorter path can let a visitor
occupy that position and choose the address used by rate limits and audit logs.
A site with one of those values still boots, using `loopback`, and logs a
warning; Security Center reports it until the value is replaced.
Every trusted proxy must overwrite or safely append forwarding headers, and the
origin must be inaccessible except through that boundary.

## Verification

The normal suite covers bounded in-memory throttles, upload admission, storage
reservation failure, job leases, and concurrent quota decisions. Real database
tests exercise the conditional job claim and transactional concurrency on both
database families when their disposable test databases are available:

```sh
JOB_QUEUE_TEST_DATABASE=1 DB_NAME=job_queue_test DB_DRIVER=postgres pnpm --filter @justflows/server exec vitest run tests/integration/database/job-queue-db.integration.test.ts
JOB_QUEUE_TEST_DATABASE=1 DB_NAME=job_queue_test DB_DRIVER=mysql pnpm --filter @justflows/server exec vitest run tests/integration/database/job-queue-db.integration.test.ts
PLUGIN_ROWS_TEST_DATABASE=1 DB_NAME=plugin_rows_test DB_DRIVER=postgres pnpm --filter @justflows/server exec vitest run tests/integration/database/plugin-rows-db.integration.test.ts
PLUGIN_ROWS_TEST_DATABASE=1 DB_NAME=plugin_rows_test DB_DRIVER=mysql pnpm --filter @justflows/server exec vitest run tests/integration/database/plugin-rows-db.integration.test.ts
```

Use `DB_DRIVER=mariadb` for the MariaDB variant. The tests require disposable
databases with the matching names and credentials in the normal `DB_*`
variables; they are skipped rather than pointed at an installation database.
