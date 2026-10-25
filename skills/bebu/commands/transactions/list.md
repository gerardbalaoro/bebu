# `bebu transactions list`

Read the complete history, including older records absent from the app cache

## Usage

```
bebu transactions list [options]
```

## Flags

| Flag | Type | Required | Description |
| ---- | ---- | -------- | ----------- |
| `--account` | string | No | Filter by the source or destination account ID |
| `--budget` | string | No | Use this budget ID. The default is the selected budget in the session |
| `--compact`, `--no-compact` | boolean | No | Return JSON without indentation |
| `--full`, `--no-full` | boolean | No | Include complete records or full dry-run writes |
| `-h`, `--help` | boolean | No | Show help |
| `--limit` | number | No | Return 1 to 1000 transactions `[default: 20]` |
| `--page-token` | string | No | Use the next page token from a list without an account filter |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference.
If a feature is absent, report that the reference does not document it.

---

Parent: [`bebu transactions`](../transactions.md)

[Skill overview](../../SKILL.md)
