---
name: git-conventions
description: "Rules for Git operations: writing commits, naming branches, and writing pull requests."
---

# Git Conventions

## Commits

Commits should be logical and focused on one concern or intent.

A commit may include multiple files and does not need to deliver a complete
feature on its own. Avoid mixing unrelated work.

Use Conventional Commits:

```text
<type>(<scope>): <subject>
```

Prefer this small set of commit types:

| Type       | Use for                                                                            |
| ---------- | ---------------------------------------------------------------------------------- |
| `feat`     | Adding or changing functionality or behaviour.                                     |
| `fix`      | Correcting faulty or unintended behaviour.                                         |
| `refactor` | Restructuring without intentionally changing behaviour.                            |
| `chore`    | Maintenance, tooling, setup, tests, dependencies, or other non-functional changes. |
| `docs`     | Pure documentation changes.                                                        |

When changes span multiple types, use the dominant type. Use `refactor` when
more than 70% of the change is refactoring, and use `docs` for pure
documentation changes.

Scopes are encouraged when useful, but optional.

Choose the scope based on the **main domain or subsystem affected by the
change**, not simply the file being edited.

When choosing a scope:

- Prefer an existing scope already used by the repository.
- Prefer product or technical domains such as `auth`, `api`, `database`, `cli`,
  or `billing`.
- In monorepos, a package or workspace name is often the best scope.
- For infrastructure or tooling changes, use the relevant technology or
  subsystem such as `docker`, `eslint`, `ci`, or `build`.
- Do not use filenames or overly specific implementation details as scopes.
- Do not create separate scopes for operating systems when the change belongs to
  a broader domain.
- If a change spans several files but serves one domain, use that domain as the
  scope.
- If a change is repository-wide or no single scope clearly fits, omit the
  scope.

When composing commits:

- Group changes by intent, not merely by file or directory.
- Keep tightly related changes together.
- Separate unrelated concerns.
- Prefer commits that can be reviewed and understood independently.

### Commit Messages

- Write the summary in imperative mood and keep it to 72 characters or fewer.
- Calibrate body bullets to the size of the change: use at most 2 bullets for
  1–3 files, 3–4 bullets for 4–10 files, and describe the theme for 10+ files.
  Never use more than 5 bullets.
- Focus body bullets on what changed and why, not implementation details.
- Do not start bullets with hollow verbs such as `Updated`, `Modified`, or
  `Changed`.

## Branches

Branch names must follow this format:

```text
<type>/<ticket>_<name>
```

- `<type>` follows the commit-type rules and reflects the branch intent, not its
  individual commits.
- `<ticket>` is the ticket identifier, following the applicable ticket conventions
  for its format and casing.
- Omit the optional `<ticket>_` prefix when no ticket exists.
- Use lowercase kebab-case for `<name>`, with at most three words.

Example: `feat/<ticket>_add-minor-feature`

## Pull Requests

Pull request titles must follow this format:

```text
<ticket>: <name>
```

- Omit the optional `<ticket>:` prefix when no ticket exists.
- Make `<name>` an imperative description of the change, such as
  `Add Singapore country`.
- Keep the ticket identity and name aligned with the branch name, using the
  applicable ticket conventions for the identifier's format and casing.

Example: `<ticket>: Add minor feature`

When drafting or updating a pull request description, read and follow
[the template](references/pr-template.md).
