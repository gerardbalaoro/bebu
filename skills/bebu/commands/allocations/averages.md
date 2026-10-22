# `bebu allocations averages`

Read average allocation and spending from prior saved months

## History basis

Select a reference month with --before and one or three saved periods with --periods. The query uses
the latest saved periods before that month, even when calendar months are absent. It averages only
positive values and truncates fractional minor units. Results include orphan category IDs,
contributing period counts, and source versions. This is a history query. It does not execute
historical auto-allocation or calculate replacement effects.

## Usage

```
bebu allocations averages [options]
```

## Flags

| Flag                        | Type    | Required | Description                                                           |
| --------------------------- | ------- | -------- | --------------------------------------------------------------------- |
| `--before`                  | string  | Yes      | Use saved periods before this YYYY-MM month                           |
| `--budget`                  | string  | No       | Use this budget ID. The default is the selected budget in the session |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                                       |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                       |
| `-h`, `--help`              | boolean | No       | Show help                                                             |
| `--periods`                 | number  | No       | Use 1 or 3 saved periods `[default: 3]`                               |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu allocations`](../allocations.md)

[Skill overview](../../SKILL.md)
