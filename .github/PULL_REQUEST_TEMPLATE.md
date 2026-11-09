## Summary

<!-- What does this change, and why? -->

## Target

Default PR target is **`develop`**, not `main`.
Use a `feature/`, `bug/`, `patch/`, `fix/`, `hotfix/`, `chore/`, `docs/`, `refactor/`, or `test/` branch.

## Test plan

- [ ] `pnpm test`
- [ ] `pnpm typecheck` (or the relevant package checks)

## Security review

For a new or changed privileged route or action, state how it handles:

- [ ] Authorization (capability or role, checked on the server)
- [ ] Tenant scope (site and workspace ownership of every object)
- [ ] Input validation
- [ ] Rate and resource limits
- [ ] Audit events (with credentials and sensitive data redacted)

## Notes

- I have signed off this commit (`git commit -s`) as described in CONTRIBUTING.md.
