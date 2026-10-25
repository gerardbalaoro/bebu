# `bebu allocations preview`

Calculate target or restricted smart funding without changing the budget

## Supported preview
Use --strategy targets (default) for ongoing savings, monthly spending, and SAVINGS targets. SAVINGS requires a stored creation timestamp and --calculation-timezone set to the native app device timezone. Fixed, dynamic, and no-deadline demands are supported; repeating targets and deadlines before creation are rejected. No target forecast or progress percentage is calculated.

Use --strategy smart to cover overspending before supported targets. Smart requires an untrimmed, empty upcoming transaction map and zero upcoming balances. It supports positive monthly spending and ongoing savings targets, or overspending without a target. Nonpositive target amounts are rejected. Snoozed targets, FUND_OVERRUNS, and SAVINGS are rejected in smart mode. Any positive funding suppresses later phases, including partial funding.

Both strategies require a flat zero-based budget, the current/latest saved month, and an explicit saved user timezone for the current-month check. Hierarchies, archived or special categories, linked accounts, ambiguous order, and ignoring available funds are rejected. Results include source versions, pool operands, and proposed amounts. Reads are not one atomic snapshot. executionSupported is false: this command cannot save the plan. Do not convert its output into manual document writes.

## Usage

```
bebu allocations preview [options]
```

## Flags

| Flag | Type | Required | Description |
| ---- | ---- | -------- | ----------- |
| `--budget` | string | No | Use this budget ID. The default is the selected budget in the session |
| `--calculation-timezone` | string | No | Native app device timezone for SAVINGS dates, for example Asia/Manila |
| `--compact`, `--no-compact` | boolean | No | Return JSON without indentation |
| `--full`, `--no-full` | boolean | No | Include complete records or full dry-run writes |
| `-h`, `--help` | boolean | No | Show help |
| `--month` | string | Yes | Select the current/latest saved YYYY-MM budget month |
| `--strategy` | string | No | Choose targets or smart `[default: "targets"]` |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference.
If a feature is absent, report that the reference does not document it.

---

Parent: [`bebu allocations`](../allocations.md)

[Skill overview](../../SKILL.md)
