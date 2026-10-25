# `bebu allocations recover`

Observe the original allocation marker without resending uncertain work

## Usage

```
bebu allocations recover <request-id> [options]
```

## Arguments

| Argument     | Type   | Required | Description                              |
| ------------ | ------ | -------- | ---------------------------------------- |
| `request-id` | string | Yes      | Use the original 20-character request ID |

## Flags

| Flag                        | Type    | Required | Description                     |
| --------------------------- | ------- | -------- | ------------------------------- |
| `--budget`                  | string  | No       | Use this budget ID              |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation |
| `-h`, `--help`              | boolean | No       | Show help                       |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu allocations`](../allocations.md)

[Skill overview](../../SKILL.md)
