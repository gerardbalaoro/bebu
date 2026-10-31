# `bebu allocations report`

Summarize monthly allocations by category and nature

## Percentage basis

The total includes negative allocations. Whole-number percentages use the sum of positive category
allocations, with negative contributions shown as zero percent. The report includes orphan balances
and retains unknown natures. This calculation matches the inspected native example; complete native
report parity is not established. This is not a ready-to-allocate balance.

## Usage

```
bebu allocations report [options]
```

## Flags

| Flag                        | Type    | Required | Description                                                           |
| --------------------------- | ------- | -------- | --------------------------------------------------------------------- |
| `--budget`                  | string  | No       | Use this budget ID. The default is the selected budget in the session |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                                       |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                       |
| `-h`, `--help`              | boolean | No       | Show help                                                             |
| `--month`                   | string  | Yes      | Select an existing YYYY-MM budget month                               |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu allocations`](../allocations.md)

[Skill overview](../../SKILL.md)
