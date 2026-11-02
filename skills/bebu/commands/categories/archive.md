# `bebu categories archive`

Archive an ordinary category while preserving its financial history

## Supported subset

Requires an explicit budget and current --month in the saved user timezone. Review --dry-run --full
first. Supports childless active modifiable DEFAULT categories and groups, no target or explicit
account links, and no canonical, category/global stash upcoming references or templates. Canonical
reference queries are snapshot-bound and each must contain fewer than 10000 records. Absent account
link fields remain uninterpreted and unchanged. The native metadata patch sets archived:true and the
current archivedAt timestamp, and deletes parentCategoryId. Historical transactions, allocations,
money and periods are untouched. No funding amount is evaluated or defaulted: independently review
and move remaining category funds before archiving. The unchanged native template rewrite is omitted
after snapshot validation. Reads and commit share one optimistic transaction. Permanent operations
bind the exact archive intent and compiled body before dispatch; an existing request never resends.
After uncertainty use transactions operation/recover with the original request ID, never replace or
replay it. Archive hides the category from the current month onward; this is not deletion or funding
repair. Other category lifecycle workflows remain separate.

## Usage

```
bebu categories archive <id> [options]
```

## Arguments

| Argument | Type   | Required | Description                          |
| -------- | ------ | -------- | ------------------------------------ |
| `id`     | string | Yes      | Use an object ID from a list command |

## Flags

| Flag                        | Type    | Required | Description                                                                                |
| --------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------ |
| `--budget`                  | string  | Yes      | Explicit budget ID                                                                         |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                                                            |
| `--dry-run`, `--no-dry-run` | boolean | No       | Preview all changes without a commit                                                       |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                                            |
| `-h`, `--help`              | boolean | No       | Show help                                                                                  |
| `--month`                   | string  | Yes      | Current month YYYY-MM in the saved user timezone                                           |
| `--request-id`              | string  | No       | Identify an operation with 20 letters or digits. Inspect existing requests before retrying |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu categories`](../categories.md)

[Skill overview](../../SKILL.md)
