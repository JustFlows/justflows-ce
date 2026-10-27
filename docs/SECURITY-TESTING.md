# Local security testing

Run from the repository root with the existing workspace dependencies installed:

```sh
pnpm test:security
```

This selects existing Vitest suites through the root workspace configuration.
It does not start a deployed Justflows instance or scan a remote host. HTTP
integration tests start their own local servers and use test doubles where
specified in each suite; they do not certify a production database or deployment.

| Boundary                         | Selected tests                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Authentication and authorization | Server auth unit tests, auth route integration tests, API-key middleware, SDK capabilities, plugin capability registry |
| CSRF and sessions                | Auth session tests and plugin API CSRF tests                                                                           |
| Uploads and filesystem access    | Upload admission, multipart limits, upload paths/store, safe ZIP extraction, installer archive safety                  |
| SSRF and outbound requests       | Pinned fetch, webhook URL validation, AI safe fetch                                                                    |
| XSS and browser protections      | Block document sanitization, safe URLs, security headers, CSP and cookie tests                                         |
| Other security controls          | Rate-limit backoff, installer throttling, secret box, audit/log handling and the remaining server security unit tests  |

A passing run means these regressions passed. It does not prove that the
platform is secure, and it does not cover every route, plugin, database dialect,
or deployment setting. Keep running `pnpm test` for the broader suite. Dependency
advisories are a separate check:

```sh
pnpm audit --audit-level high
```

## Local red-team reviews

Use the workspace's local `red-agents-team` skill for a structured security review.
Its skills are maintained independently alongside review roles, finding templates
and a regression workflow. They provide review guidance; `pnpm test:security`
runs executable tests separately.

Record the selected skill paths and relevant local skill changes for each review.
Read the selected files before applying them.
Focus on these Justflows boundaries:

- SQL injection: trace request values into parameterized database queries, including plugin queries.
- IDOR and API authorization: try anonymous, lower-role and different-site fixture users against the same object; verify denied requests leave state unchanged.
- XSS: check stored content and admin rendering using inert marker payloads, including plugin output.
- SSRF: verify private, loopback, redirect and DNS-resolution boundaries with mocked or local fixture endpoints.
- Uploads and traversal: verify rejected paths, filenames, archive entries and size limits using disposable fixture files.
- Authentication and business logic: check session/CSRF enforcement, revoked keys, password reset, MFA and capability checks.

Use a disposable local installation with synthetic users and data for runtime
checks. Define the local target, routes and test accounts explicitly; scope the
review to that instance. Do not point the review at production or external
services. Source-level tests above can run without a deployed instance.

Suggested review request after reading a selected local skill:

> Review the specified Justflows boundary using the selected local security
> methodology. Target only this repository and the explicitly supplied disposable
> local instance. Record source locations, preconditions, expected and observed
> behavior, and a minimal local reproduction for each finding. Turn confirmed
> findings into tests in the owning app or package. Label unverified concerns
> separately, and report which boundaries were not tested.

Retain each confirmed reproduction as a deterministic regression test in the
owning `tests/` tree. Extend `test:security` if it falls outside the current
selection. Keep private findings and local run artifacts out of public commits;
follow [the security policy](../SECURITY.md) for disclosure.
