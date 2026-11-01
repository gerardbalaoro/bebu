# `bebu targets remove`

Remove a monthly spending target without changing stored funding

## Supported subset

Supports explicit positive SPENDING/MONTHLY targets on active DEFAULT categories with
modifiable:true and no parent or children. Raw account links remain untouched and are not
interpreted. Preview with --dry-run and an explicit budget. The complete target is deleted under a
snapshot version precondition. Existing category funds, history, account money, and other settings
are not directly changed. Future target demand and automatic funding suggestions intentionally
change. Creation, edits, savings/repeating targets, and hierarchical categories require separate
workflows.

## Usage

```
bebu targets remove <id> [options]
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
| `--request-id`              | string  | No       | Identify an operation with 20 letters or digits. Inspect existing requests before retrying |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu targets`](../targets.md)

[Skill overview](../../SKILL.md)
