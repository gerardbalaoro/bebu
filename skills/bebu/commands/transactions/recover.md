# `bebu transactions recover`

Observe a saved transaction request without resending financial writes

## Recovery boundary

Use the original 20-character request ID and explicit budget. Keep BEBU_HOME and its permanent
operation records. Recovery observes the saved marker and bounded current document versions; it
never resends. A marker alone does not bind a payload or prove an unknown commit. Missing or corrupt
local records remain unresolved. A known rejected attempt needs a fresh reviewed preview and a new
request ID; unknown or sending attempts require observation.

## Usage

```
bebu transactions recover <request-id> [options]
```

## Arguments

| Argument     | Type   | Required | Description                             |
| ------------ | ------ | -------- | --------------------------------------- |
| `request-id` | string | Yes      | Original durable transaction request ID |

## Flags

| Flag                        | Type    | Required | Description                                                           |
| --------------------------- | ------- | -------- | --------------------------------------------------------------------- |
| `--budget`                  | string  | No       | Use this budget ID. The default is the selected budget in the session |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                                       |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                       |
| `-h`, `--help`              | boolean | No       | Show help                                                             |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu transactions`](../transactions.md)

[Skill overview](../../SKILL.md)
