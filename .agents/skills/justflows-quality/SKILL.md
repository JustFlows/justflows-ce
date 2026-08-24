---
name: justflows-quality
description: Test, review, debug, and verify Justflows changes across the monorepo. Use for regressions, code review, test design, type errors, lint or build failures, and release-readiness checks.
---

# Justflows Quality

Start from observed behavior or the changed diff. Do not erase or reformat unrelated working-tree changes. Reproduce failures with the narrowest deterministic command before changing code.

- Put unit tests in the owning package's existing test structure.
- Test public behavior and invariants, not wording or private call order.
- For routes, cover authentication, capabilities, validation, status/body behavior, and integration.
- For persistence, cover supported dialect assumptions and migration compatibility.
- For extension, archive, auth, media, and updater paths, include adversarial boundaries.
- For admin UI work, cover types/build plus meaningful manual states when no UI harness exists.

Use pnpm workspace filters during iteration. Escalate to root `pnpm typecheck`, `pnpm test`, and `pnpm build` based on blast radius. Distinguish new failures from pre-existing failures and report exact commands.

## CI that must not come back

- Never add `actions/dependency-review-action` as a required job in `.github/workflows/ci.yml`. Public `justflows-ce` does not enable Dependency graph, so the job fails every PR with "Dependency review is not supported on this repository." The advisory gate is `pnpm audit --audit-level high` in the `security` job.
- Do not skip or suppress CodeQL to clear a public PR. Fix path, log-injection, format-string, rate-limit, and TOCTOU findings in code. When syncing private → public, keep CodeQL enabled and do not restore the dependency-review job.
