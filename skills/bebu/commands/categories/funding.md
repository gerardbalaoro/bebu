# `bebu categories funding`

Read category funds for one month in integer minor units

## Funding amounts

Available funds equal allocatedAmount + carriedOverAmount + otherAmount - spentAmount.
upcomingAmount is separate. Missing amount fields count as zero. Categories without a balance have
zero funds. Balance IDs absent from the category index remain visible.

Account balances describe account money. Category funds describe its budget assignment. This query
does not calculate ready-to-allocate funds or parent totals.

## Usage

```
bebu categories funding [options]
```

## Flags

| Flag                        | Type    | Required | Description                                                           |
| --------------------------- | ------- | -------- | --------------------------------------------------------------------- |
| `--budget`                  | string  | No       | Use this budget ID. The default is the selected budget in the session |
| `--category`                | string  | No       | Return only this category ID                                          |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                                       |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                       |
| `-h`, `--help`              | boolean | No       | Show help                                                             |
| `--month`                   | string  | Yes      | Select an existing budget month in YYYY-MM format                     |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu categories`](../categories.md)

[Skill overview](../../SKILL.md)
