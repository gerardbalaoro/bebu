# `bebu transactions create`

Create an expense or income with all ledger changes. The command does not allocate funds
automatically

## Usage

```
bebu transactions create [options]
```

## Flags

| Flag                        | Type    | Required | Description                                                                         |
| --------------------------- | ------- | -------- | ----------------------------------------------------------------------------------- |
| `--budget`                  | string  | No       | Use this budget ID. The default is the selected budget in the session               |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                                                     |
| `--dry-run`, `--no-dry-run` | boolean | No       | Preview all changes without a commit                                                |
| `--file`                    | string  | Yes      | Read the JSON payload from this file. Use - for stdin                               |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                                     |
| `-h`, `--help`              | boolean | No       | Show help                                                                           |
| `--request-id`              | string  | No       | Identify one operation with 20 letters or digits. Reuse only for an identical retry |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu transactions`](../transactions.md)

[Skill overview](../../SKILL.md)
