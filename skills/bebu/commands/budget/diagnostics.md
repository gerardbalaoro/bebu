# `bebu budget diagnostics`

Read stored account/category links and allocation settings with their source paths

## Observed fields
This command reads the budget, user, accounts index, and categories index. It returns stored link fields, config objects, and recognized allocation setting names. Values remain raw, including unknown enums and conflicting links. An absent field has no inferred default. The output does not establish native behavior or list every possible setting.

## Usage

```
bebu budget diagnostics [options]
```

## Flags

| Flag | Type | Required | Description |
| ---- | ---- | -------- | ----------- |
| `--budget` | string | No | Use this budget ID. The default is the selected budget in the session |
| `--compact`, `--no-compact` | boolean | No | Return JSON without indentation |
| `--full`, `--no-full` | boolean | No | Include complete records or full dry-run writes |
| `-h`, `--help` | boolean | No | Show help |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference.
If a feature is absent, report that the reference does not document it.

---

Parent: [`bebu budget`](../budget.md)

[Skill overview](../../SKILL.md)
