# Beyond Budget Integration

This guide helps maintainers extend BeBu from the native app's behavior. The CLI owns financial
calculations. Generated skills select commands and interpret results without calculating missing
amounts.

## Current Support

| Need                                                     | Command                                        |
| -------------------------------------------------------- | ---------------------------------------------- |
| Category funds for a month                               | `categories funding`                           |
| Raw account links and allocation settings                | `budget diagnostics`                           |
| Allocation records and optional transaction associations | `allocations history`                          |
| Allocated amounts by category and nature                 | `allocations report`                           |
| Positive allocation and spending averages                | `allocations averages`                         |
| Raw target settings                                      | `targets list`                                 |
| Target or restricted smart funding preview               | `allocations preview`                          |
| Manual allocation or linked savings matching plan        | `allocations set`                              |
| Apply a reviewed manual plan                             | `allocations apply`                            |
| Inspect or recover a local allocation operation          | `allocations operation`, `allocations recover` |

Use the [generated command reference](../../skills/bebu/SKILL.md) for arguments and restrictions.
The preview supports a limited set of flat zero-based budgets and targets. It reports
`executionSupported: false`. Manual allocation has a separate transaction-protected write path.
Reallocation, undo, automatic income allocation, and smart allocation writes remain unsupported.

Transaction dry runs show account balances, category funds, payment reserves, and allocation
resources. Cleared, completed zero-based income increases allocation resources but does not fund
categories. Active native allocation predicates, allocation history, and autoAllocated extras block
deletion, financial edits, and schedule edits. Inactive allocation flags alone do not block edits.

Uncleared income changes only the uncleared account balance. Clearing moves the amount into the
cleared balance and account history. Unclearing reverses those movements. Income history requires
agreement between the stored month and the due-date month in the CLI runtime timezone.

[Transaction Editing](transaction-editing.md) records supported amount, assignment, date, and
recurrence edits. Upcoming records without saved periods remain periodless. Creating and deleting
recurring transactions, completing payments, and generating occurrences remain separate native
workflows.

## Data Model

| Document             | Relevant Fields                                                            |
| -------------------- | -------------------------------------------------------------------------- |
| Budget               | `availablePeriods`, `stashIdentifiers`, `allocationHistory`                |
| Group/category stash | `data.groups`, `data.categories`                                           |
| Account stash        | `data.<accountId>`                                                         |
| Period               | `balances.<categoryId>`, `allocationAmount`, `allocationCarriedOverAmount` |
| Category stash       | `data.historicalAllocations.<YYYY-MM>`                                     |
| Authenticated user   | `config`                                                                   |

Category availability equals `allocatedAmount + carriedOverAmount + otherAmount - spentAmount`.
Upcoming obligations, target progress, and the budget's unallocated money are separate amounts. A
card purchase reduces expense-category funds and increases the payment category's raw reserve by the
full amount, even when unfunded. [Card Purchases And Refunds](card-transactions.md) records the
signed ledger and history effects. Use create type `REFUND` with a positive amount and expense
category to reverse those movements. Historical purchase dates remain intact and do not require
historical allocation support.

Canonical transactions contain more history than trimmed stash previews or browser caches.
Transaction writes also maintain indexes, counters, and historical amounts. The canonical document
alone is not a complete write set.

Account `linkedCategoryId` and category `linkedAccountIds` describe opposite sides of a link.
Allocation history map keys and stored IDs can differ. Empty `extras` does not exclude automatic
allocation. History source determines the meaning of its amount fields.

## Rules And Remaining Gaps

[Recovered App Structure](architecture.md) preserves the data types, model construction, service
paths, persistence rules, and source-specific history meanings.

[Source Reconstruction](source-reconstruction.md) explains what source information survives and
demonstrates a calculation compared against extracted WASM instructions.

[Savings Target Schedules](target-schedules.md) records the recovered deadline formulas and date
rules. SAVINGS previews require explicit stored creation timestamps and `--calculation-timezone`.
That timezone must match the native app device timezone. Fixed, dynamic, and no-deadline demands are
supported. Repeating targets and target forecasts remain unsupported.

[Allocation Persistence](allocation-persistence.md) records save completion, undo, and retry rules.
The direct writer returns before server confirmation. Undo subtracts the recorded change from the
current allocation, then separately marks the original history entry.

[Manual Allocation Writer](allocation-writer.md) describes the implemented command flow and support
boundary.

[Allocation Write Implementation Plan](allocation-write-plan.md) preserves disposable-budget runtime
evidence from 2026-10-25. It covers optimistic transactions, native manual and linked saves, marker
permissions, bounded carryover, and the proposed CLI implementation sequence.

[Linked Income Allocation](linked-allocation.md) records creation, clearing changes, deletion, and
their separate history writes. The CLI follows the recovered independent-income balance movements
and retains its guards against linked-allocation writes.

[Smart Allocation](smart-allocation.md) records upcoming membership, category priority, and phase
overlap. `allocations preview --strategy smart` covers overspending and supported targets when the
upcoming map is empty, its stash is untrimmed, and upcoming balances are zero.

[Allocation Rules](allocation-contract.md) contains the recovered formulas, defaults, ordering, and
save boundaries. Those earlier findings come from static analysis and read-only app observations in
October 2026. The implementation plan adds native mutation fixtures. Neither set establishes
complete parity.

Remaining work includes:

- Broader carryover, allocation undo, and shared request identity across devices.
- Linked-account allocation and its reversal effects.
- Parent and surplus coverage, including their precedence.
- Smart planning with upcoming bills, stash completeness, and upstream recurring-transaction
  effects.
- Other target schedules, repeat lifecycle, historical replacement, and equal stored-order ties.

Reallocation is a separate transaction flow, not two manual allocations. History deletion does not
undo an allocation. A surplus forecast does not prove that money was allocated.

Native save markers prove existence only. Manual allocation binds a request to a durable local
operation record and never automatically resends uncertain work. Existing transaction-command
retries still depend on marker expiry and validation before commit.

## Validate New Writes

1. Use an authorized disposable budget for native mutation experiments.
2. Record the budget type, month, timezone, links, settings, and affected documents before one
   action.
3. Compare backend documents after synchronization, including history, indexes, and later periods.
4. Capture undo separately and remove personal data from fixtures.
5. Test stale versions, identical retries, changed payloads, insufficient funds, and unsupported
   inputs.

Reuse one browser window without focus changes. The app needs WebGL2 and a visible tab to repaint.
If accessibility snapshots are stale, inspect a fresh screenshot. Strategy selections can save
immediately. Report views can change interaction counters even without a financial submission.

## Source Of Truth

[Command definitions](../../src/cli/app.ts) define CLI syntax.
[Transaction code](../../src/budget/transactions.ts) defines supported transaction effects.
[The skill generator](../../src/cli/skills.ts) owns workflow guidance. Regenerate skills with
`bun run skills` after changes to command definitions or guidance.

Product references:
[Auto-Allocation](https://www.beyondbudgetapp.com/quality-of-life/auto-allocation),
[Targets](https://www.beyondbudgetapp.com/basics/targets),
[Allocation History](https://www.beyondbudgetapp.com/basics/allocation-history),
[Surplus Funds](https://www.beyondbudgetapp.com/basics/surplus-funds-overview). Product descriptions
do not establish complete database effects.
