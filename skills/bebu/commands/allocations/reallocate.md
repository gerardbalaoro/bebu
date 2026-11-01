# `bebu allocations reallocate`

Move category funds with one native reallocation transaction and history entry

## Supported subset

Use an explicit budget, source, destination, positive minor-unit amount, month and native device
calculation timezone. The timezone must match the CLI runtime. Preview --dry-run --full first.
Supports only the latest saved month, current or future, ordinary flat unlinked categories with
explicit ALL carryover and no targets or coverage strategies. Every consumed financial amount,
allocation history value, link and counter must be explicit. All four indexes must be small,
complete and explicitly untrimmed. Missing values block execution without defaults. Source
availability must cover the transfer. The CLI atomically saves the native transaction, both
allocations, four preview indexes, counters, category histories and the root MONEY_REALLOCATION
history entry. This consolidates the native app's two save boundaries. No manual allocation, account
money, pool resources or carryover is written. Historical propagation and future period
materialization remain unsupported. Inspect the preview before committing; live commands read fresh
state. Permanent transaction operation records bind the request before dispatch. Use transactions
operation/recover with the original request ID after uncertainty; neither retry nor recovery
resends. Marker/current-value observations cannot prove a lost acknowledgment. Keep BEBU_HOME. Undo,
deletion, linked categories, hierarchy, large/trimmed indexes and the held migration discrepancy
remain unsupported.

## Usage

```
bebu allocations reallocate [options]
```

## Flags

| Flag                        | Type    | Required | Description                                                                                |
| --------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------ |
| `--amount-minor`            | number  | Yes      | Positive transfer amount in integer minor units                                            |
| `--budget`                  | string  | No       | Use this budget ID. The default is the selected budget in the session                      |
| `--calculation-timezone`    | string  | Yes      | Native device timezone, matching the CLI runtime timezone                                  |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                                                            |
| `--dry-run`, `--no-dry-run` | boolean | No       | Preview all changes without a commit                                                       |
| `--from`                    | string  | Yes      | Source category ID                                                                         |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                                            |
| `-h`, `--help`              | boolean | No       | Show help                                                                                  |
| `--month`                   | string  | Yes      | Latest saved YYYY-MM month                                                                 |
| `--request-id`              | string  | No       | Identify an operation with 20 letters or digits. Inspect existing requests before retrying |
| `--to`                      | string  | Yes      | Destination category ID                                                                    |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu allocations`](../allocations.md)

[Skill overview](../../SKILL.md)
