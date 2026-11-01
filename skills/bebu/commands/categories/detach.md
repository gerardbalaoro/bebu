# `bebu categories detach`

Move an ordinary subcategory out of its parent

## Supported subset

Use --parent for the intended parent on attach or expected current parent on detach. Supports active
DEFAULT categories and group with explicit modifiable:true, in the same group, one level only. The
source must have no children. The entire affected family must lack target, aggregation,
accumulation, and computation settings and recorded links. Every account must have explicit link
evidence; a family account link blocks the change. Missing category link lists are preserved without
defaults. Explicit safe orders must remain unambiguous; no order is changed. Attach writes
parentCategoryId and groupId; detach deletes parentCategoryId. Reads and commit share one optimistic
transaction. No direct funding, history, account, target, or transaction writes occur. Parent
coverage membership changes and future funding outcomes are not predicted. This does not repair
carryover or enable historical transaction edits. Preview with an explicit budget and --dry-run
--full. After uncertainty or marker-only confirmation, inspect categories list --full before another
command; do not blindly retry. Cross-group moves, targeted or linked families, subtrees, creation,
archive, and reordering remain unsupported.

## Usage

```
bebu categories detach <id> [options]
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
| `--parent`                  | string  | Yes      | Expected current parent ID                                                                 |
| `--request-id`              | string  | No       | Identify an operation with 20 letters or digits. Inspect existing requests before retrying |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu categories`](../categories.md)

[Skill overview](../../SKILL.md)
