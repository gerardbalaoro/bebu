# `bebu allocations set`

Preview one absolute allocation or match its linked savings account

## Manual allocation

Requires --dry-run. Choose exactly one of --amount-minor or --match-linked. Negative amounts use
--amount-minor=-2500. All amounts are signed integer minor units. Matching uses the cleared balance
of exactly one active linked SAVINGS account. Uncleared money is reported separately. A zero-balance
archived account with an empty reverse link is reported and preserved.

The planner uses one consistent snapshot and includes the complete budget pool. It supports DEFAULT
leaf categories, one-level hierarchy elsewhere, payment-category presence, FUND_OVERRUNS, and ALL
carryover on the selected category. It rejects historical months, period creation, archived
categories, broken links, multiple future periods, and income, spending, or other funds in the next
month. Positive deltas cannot overdraw the pool.

--plan-file saves the private reviewed plan for allocations apply. --full includes the exact
four-document write set. No financial write occurs during planning. The plan expires after 15
minutes and any changed dependency makes it stale. Target/smart preview commands remain read-only
and cannot be applied through this command.

## Usage

```
bebu allocations set <id> [options]
```

## Arguments

| Argument | Type   | Required | Description |
| -------- | ------ | -------- | ----------- |
| `id`     | string | Yes      | Category ID |

## Flags

| Flag                                  | Type    | Required | Description                                                        |
| ------------------------------------- | ------- | -------- | ------------------------------------------------------------------ |
| `--amount-minor`                      | string  | No       | Set this signed safe-integer absolute allocation                   |
| `--budget`                            | string  | No       | Use this budget ID                                                 |
| `--compact`, `--no-compact`           | boolean | No       | Return JSON without indentation                                    |
| `--dry-run`, `--no-dry-run`           | boolean | Yes      | Required: calculate without changing financial state               |
| `--full`, `--no-full`                 | boolean | No       | Include the complete reviewed plan and writes                      |
| `-h`, `--help`                        | boolean | No       | Show help                                                          |
| `--match-linked`, `--no-match-linked` | boolean | No       | Match availability to one active savings account's cleared balance |
| `--month`                             | string  | Yes      | Use the current existing YYYY-MM month                             |
| `--plan-file`                         | string  | No       | Save the complete private plan to this file                        |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu allocations`](../allocations.md)

[Skill overview](../../SKILL.md)
