# `bebu targets list`

Read target settings separately from category funds

## Target progress
Target settings remain raw, including unknown types and snooze settings. An optional month includes the stored balance. Availability is null when required balance fields are absent. Target progress is not calculated and must not be inferred from category availability.

## Usage

```
bebu targets list [options]
```

## Flags

| Flag | Type | Required | Description |
| ---- | ---- | -------- | ----------- |
| `--budget` | string | No | Use this budget ID. The default is the selected budget in the session |
| `--category` | string | No | Return the target for this category ID |
| `--compact`, `--no-compact` | boolean | No | Return JSON without indentation |
| `--full`, `--no-full` | boolean | No | Include complete records or full dry-run writes |
| `-h`, `--help` | boolean | No | Show help |
| `--month` | string | No | Include funds from an existing YYYY-MM budget month |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference.
If a feature is absent, report that the reference does not document it.

---

Parent: [`bebu targets`](../targets.md)

[Skill overview](../../SKILL.md)
