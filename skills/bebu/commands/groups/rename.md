# `bebu groups rename`

Rename one group without changing financial or hierarchy fields

## Supported subset

Supports active DEFAULT records with explicit modifiable:true and matching stored identities. The
name is trimmed and must contain 1–200 characters; this is a CLI limit. Preview with --dry-run; add
--full for the exact name-only patch. Reads and commit use one Firestore transaction with a version
precondition. Archive, creation, hierarchy changes, targets, and financial settings are separate
workflows. A save marker proves request existence only; inspect the current name after an uncertain
outcome before another command.

## Usage

```
bebu groups rename <id> [options]
```

## Arguments

| Argument | Type   | Required | Description                          |
| -------- | ------ | -------- | ------------------------------------ |
| `id`     | string | Yes      | Use an object ID from a list command |

## Flags

| Flag                        | Type    | Required | Description                                                                                |
| --------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------ |
| `--budget`                  | string  | No       | Use this budget ID. The default is the selected budget in the session                      |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                                                            |
| `--dry-run`, `--no-dry-run` | boolean | No       | Preview all changes without a commit                                                       |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                                            |
| `-h`, `--help`              | boolean | No       | Show help                                                                                  |
| `--name`                    | string  | Yes      | New name (1–200 characters)                                                                |
| `--request-id`              | string  | No       | Identify an operation with 20 letters or digits. Inspect existing requests before retrying |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu groups`](../groups.md)

[Skill overview](../../SKILL.md)
