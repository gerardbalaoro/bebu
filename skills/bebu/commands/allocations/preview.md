# `bebu allocations preview`

Calculate target funding without changing the budget

## Supported preview

The CLI calculates ongoing-savings and monthly-spending targets from saved data. It applies
snoozing, category order, and the authenticated user's partial-funding setting. It requires a flat
zero-based budget, the current/latest saved month, and an explicit saved timezone. Hierarchies,
archived or special categories, linked accounts, ambiguous order, other target formulas, and
ignoring available funds are rejected. Upcoming amounts do not prevent a target preview. The result
shows source document versions, pool operands, category allocations before and after, and
shortfalls. Reads are not one atomic snapshot. executionSupported is false: this command cannot save
the plan. Do not convert its output into manual document writes.

## Usage

```
bebu allocations preview [options]
```

## Flags

| Flag                        | Type    | Required | Description                                                           |
| --------------------------- | ------- | -------- | --------------------------------------------------------------------- |
| `--budget`                  | string  | No       | Use this budget ID. The default is the selected budget in the session |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                                       |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                       |
| `-h`, `--help`              | boolean | No       | Show help                                                             |
| `--month`                   | string  | Yes      | Select the current/latest saved YYYY-MM budget month                  |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu allocations`](../allocations.md)

[Skill overview](../../SKILL.md)
