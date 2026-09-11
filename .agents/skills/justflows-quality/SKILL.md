---
name: justflows-quality
description: Test, review, debug, and verify Justflows changes across the monorepo. Use for regressions, code review, test design, type errors, lint or build failures, and release-readiness checks.
---

# Justflows Quality

Never add Cursor or any AI as a git co-author or contributor. After a commit, verify `git log -1 --format='%B'` has no `Co-authored-by: Cursor` trailer.

Release notes and `CHANGELOG.md` must keep the [Public Roadmap](https://github.com/orgs/JustFlows/projects/35) issue link on each shipped bullet. Close those `justflows-ce` issues when the version lands on public `justflows-ce` `main`, not when work merges to `develop` here. See `.agents/skills/justflows-changelog/SKILL.md`.

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
- `js/missing-rate-limiting` only recognizes `express-rate-limit` (and a few similar packages) as middleware. A custom in-process counter is not enough.
- `js/log-injection` only treats `.replace(/\n/g, "")` / `.replace(/\r/g, "")` (empty replacement) or `JSON.stringify` as sanitizers. Replacing newlines with `_` inside a helper does not clear the alert.

## MANDATORY — self-check before every push touching regex, hashing, auth, paths, or rate limits

CodeQL only reports on a PR into `develop` (see `AGENTS.md`); do not wait for that CI run to discover findings you could have caught by reading the diff yourself first. Any diff touching a regular expression, a `crypto.createHash`/hashing call, request parsing, filesystem paths, or a new/changed route walks this list *before* it is pushed, not after CI fails:

- **`js/polynomial-redos`** — a regex is suspect the moment two adjacent (or alternated) quantified groups can match the *same* character class against attacker- or library-controlled input, e.g. `\s+(.+)$` (both match a space) or `^\/+|\/+$` applied with the global flag to a string with a long run of the repeated character not anchored at the true end. Fix in code: replace the ambiguous part with a fixed-width anchor plus a plain string op (`.slice`/`.trim`/a manual index scan), not a cleverer regex — a rewritten regex can still be quadratic in a different way that's harder to spot on review. See `apps/server/src/middleware/api-key-auth.ts` (`bearerToken`) and `packages/sdk/src/plugin.ts` (`stripSlashes`) for the pattern.
- **`js/insufficient-password-hash`** — this query's source heuristic matches on the *name* of a variable, property, or function argument (anything matching `/password/i`), not on whether the value is actually credential material. It routinely fires on feature flags and settings shaped like `passwordResetEnabled`/`passwordResetRoles` reaching a fast, non-credential hash (an ETag, a cache-key digest). Before assuming it's a false positive: (1) grep for where the flagged value is actually produced and confirm it is a boolean/enum/config, never a raw secret; (2) confirm real password storage in this repo still goes through `apps/server/src/lib/password.ts` / `packages/auth/src/password.ts` (salted PBKDF2, 600k iterations) and was not bypassed. Only once both are confirmed does `CONTRIBUTING.md`'s "demonstrably intentional and documented" exception apply — suppress with an inline `// codeql[js/insufficient-password-hash]: <why>` comment on the flagged line explaining what the value actually is and why the hash only needs to be fast, not slow. Do not rename the field to dodge the heuristic if the name is a real, externally-visible API/settings key (`password_reset_enabled` in `/api/manage/v1` responses, the DB setting key) — that trades a lint alert for a breaking API/data-migration change, which is worse.
