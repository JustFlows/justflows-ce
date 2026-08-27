---
name: justflows-changelog
description: >-
  Attach Justflows CE Public Roadmap issues to CHANGELOG.md. Use when adding
  features, fixes, changelog entries, closing GitHub issues, shipping a
  release, or when the user mentions roadmap, Project 35, or tickets.
---

# Justflows changelog and roadmap tickets

The public roadmap is [Justflows CE — Public Roadmap](https://github.com/orgs/JustFlows/projects/35). Items are GitHub issues on `JustFlows/justflows-ce` (for example `https://github.com/JustFlows/justflows-ce/issues/20`). Work happens in this repo (`justflows-ce-development`).

## When you change product behavior

1. Find the matching Project 35 issue (`gh` GraphQL `projectV2(number: 35)` or the board). If none exists, say so in the PR; do not invent a ticket number.
2. Add or update the entry under the current **Unreleased** (or in-progress version) section in `CHANGELOG.md`.
3. End the bullet with the issue link so the ticket is attached and closable later:

```markdown
- Admin → Users: dedicated Edit User page (`/admin/users/:id`). ([#56](https://github.com/JustFlows/justflows-ce/issues/56))
```

Use the `justflows-ce` issue URL even though the PR is in this repo. Keep one issue link per changelog bullet that implements that ticket. Multiple bullets may share the same issue if they are one roadmap item.

## When to close the ticket

Do **not** close the Project 35 / `justflows-ce` issue when the feature PR merges to `develop` here.

Close it when that changelog line has shipped on public `justflows-ce`:

1. This repo: `develop` → `main` (sync Action opens a PR into `justflows-ce` `developers`).
2. `justflows-ce`: merge `developers`, then cut the version `developers` → `main` (tag/release).
3. Then close the issue and move the Project 35 card to **Shipped** if the board still shows it open.

If Dirk asks to close earlier, follow that. If the work is only a partial slice of a larger roadmap issue, leave the issue open and say what remains.

## Do not

- Put Cursor or any AI in the changelog.
- Close roadmap issues only because CI is green on a feature branch.
- Link `justflows-ce-development` issue numbers unless that is where the roadmap item actually lives (Project 35 items are on `justflows-ce`).
