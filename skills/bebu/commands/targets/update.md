# `bebu targets update`

Edit a positive monthly spending target

## Supported subset

Supports active DEFAULT categories with explicit modifiable:true and no parent or children. Both
--amount-minor and --carry-over are required. The carry-over setting belongs to target demand; it
does not change category carryover. Creation requires an absent target field and uses the current
creation timestamp. Update requires a complete known SPENDING/MONTHLY target with a native
whole-second timestamp. Like the native spending editor, changed settings renew createdAt from the
current clock. Unknown fields, schedules, snoozes, savings targets, and hierarchy are rejected. The
complete target is serialized and replaced under one snapshot version precondition. No funds,
account, history, or transaction documents are directly changed; future target demand and automatic
funding suggestions change. After an uncertain outcome or marker-only confirmation, inspect targets
list before another command; do not blindly retry.

## Usage

```
bebu targets update <id> [options]
```

## Arguments

| Argument | Type   | Required | Description                          |
| -------- | ------ | -------- | ------------------------------------ |
| `id`     | string | Yes      | Use an object ID from a list command |

## Flags

| Flag                        | Type    | Required | Description                                                                                |
| --------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------ |
| `--amount-minor`            | number  | Yes      | Positive safe integer target amount in minor units                                         |
| `--budget`                  | string  | No       | Use this budget ID. The default is the selected budget in the session                      |
| `--carry-over`              | string  | Yes      | Explicit target carryover policy: ALL or NONE                                              |
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
