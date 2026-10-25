# `bebu allocations operation`

Inspect the original local allocation operation without sending writes

## Usage

```
bebu allocations operation <request-id> [options]
```

## Arguments

| Argument     | Type   | Required | Description                              |
| ------------ | ------ | -------- | ---------------------------------------- |
| `request-id` | string | Yes      | Use the original 20-character request ID |

## Flags

| Flag                        | Type    | Required | Description                                   |
| --------------------------- | ------- | -------- | --------------------------------------------- |
| `--budget`                  | string  | No       | Use this budget ID                            |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation               |
| `--full`, `--no-full`       | boolean | No       | Include the complete reviewed plan and writes |
| `-h`, `--help`              | boolean | No       | Show help                                     |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu allocations`](../allocations.md)

[Skill overview](../../SKILL.md)
