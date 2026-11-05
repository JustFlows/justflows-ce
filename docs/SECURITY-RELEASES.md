# Security releases

This runbook is for maintainers handling a private vulnerability report. For how to
report one, see [SECURITY.md](../SECURITY.md). Keep exploit details, customer data,
and credentials out of public issues, pull requests, and commit messages until the
advisory is published, and keep reproduction details out of them after that.

## 1. Triage

1. Acknowledge the report.
2. Reproduce it privately on a disposable installation with synthetic data. Never
   test against production or customer systems.
3. Check the latest release and the current development revision separately.
4. Assign a severity and one owner, and record which versions are affected.

## 2. Decide the release impact

| Severity       | Action                                                          |
| -------------- | --------------------------------------------------------------- |
| Critical, high | Blocks the affected release until fixed. Ship a patch release   |
| Medium, low    | Assign an owner and a disposition, and fix in a planned release |

Record any decision to ship with a known risk, including who accepted it and why.

## 3. Fix privately

1. Work in a GitHub security advisory fork or in private development. Do not use a
   public branch.
2. Add a deterministic regression test. Denial tests must show that no state
   changed.
3. Use neutral public wording for the commit and changelog until disclosure.
4. For an extension, also decide whether affected versions should be withdrawn.

## 4. Release

Collect this evidence before you publish, and keep it with the release record:

- [ ] `pnpm test`, `pnpm test:security`, and `pnpm typecheck` results
- [ ] `pnpm audit --audit-level high` and `pnpm scan:secrets` results
- [ ] CodeQL results, with every new alert resolved
- [ ] Migration and rollback check on PostgreSQL, MySQL, and MariaDB, where
      persistence changed
- [ ] Upgrade check from the previous release
- [ ] Signed archive, with the signature, checksum, and verified SBOM attached
- [ ] Unresolved risk decisions, with an owner for each
- [ ] Documentation updates and changelog links

The release body must contain the full matching `CHANGELOG.md` section.

## 5. Disclose

1. Publish the GitHub security advisory with the affected versions, the fixed
   version, and any operator action.
2. Add the advisory to the signed feed and publish it. See
   [security advisories](SECURITY-ADVISORIES.md). Use a higher sequence number.
3. Confirm that a test installation on an affected version reports the advisory.
4. Tell affected operators directly where the impact calls for it.

## 6. Follow up

Check whether the same mistake exists elsewhere, and add a review or test that
would have caught it. Repeat an independent review after material changes to auth,
tenancy, extensions, or update trust.
