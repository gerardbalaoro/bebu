# Allocation Rules

These rules support the current CLI preview and identify boundaries for future writes. They come
from the app inspected on 2026-10-22 and 2026-10-23. No native mutation fixture exists.

## Evidence Identity

The inspected module was `4ef2928daa118d1b3431.wasm` from `app.beyondbudgetapp.com`. Its SHA-256 is
`1c9b9bb1e7699c7080cba0095485e04772285c200ab458f57346161d233a9eea`. Function numbers refer only to
that build. `wasm-tools 1.262.0` decoded it successfully.

| Rule                           | Native Functions           |
| ------------------------------ | -------------------------- |
| Pool and category aggregation  | 50331, 49229, 45215        |
| Base order and target priority | 49204, 48078, 51913, 51914 |
| Target demand and eligibility  | 49209, 49244, 44704, 51912 |
| Sequential distribution        | 51863                      |
| Historical averages            | 51858, 51859               |
| Direct allocation saves        | 50304, 50296, 51916        |

## Pool And Order

```text
unallocated = allocationAmount + allocationCarriedOverAmount - allocated total
```

The allocated total excludes INCOME groups. COMPUTE categories contribute signed allocations,
including categories without targets. SKIP categories do not contribute. Ordinary allocation does
not decrement `allocationAmount`.

The base sequence uses ascending group order, then category order. Target allocation sorts this
sequence by weekday, then day of month. Absent target dates sort last. Weekdays run from Monday
through Sunday. Equal target priorities preserve the base sequence.

Equal stored orders depend on collection order, which remains unresolved across snapshot formats.
The CLI rejects those ties. Native hierarchy lists all parents first, then each parent's children.
The current preview rejects hierarchy and archival cases.

## Defaults And Settings

Native omission defaults are:

| Fields                                                          | Default                   |
| --------------------------------------------------------------- | ------------------------- |
| Category computation / accumulation / carryover                 | COMPUTE / DEFAULT / ALL   |
| Category target / aggregate target allocations                  | null / false              |
| Target type / amount / period / carryover                       | SPENDING / 0 / null / ALL |
| Target allocated-only / snooze schedule                         | null / empty map          |
| Group and category order                                        | 0                         |
| Missing balance operands, category balances, and period amounts | 0                         |

A missing document remains an error. Explicit null does not imply omission. The DTO decoders are
48544, 48558, 48703, 48804, and 48812.

Allocation settings belong to the authenticated user's `config` (51034, 51360). Their omission
defaults are partial=true, overwrite=false, and ignore-pool=false (49071, 49074). Target allocation
uses partial and ignore-pool. Overwrite does not affect this strategy. The CLI rejects
ignore-pool=true. Native code uses the maximum signed 64-bit integer for that mode.

## Target Funding

Ongoing savings requests `max(target - allocation - positive child allocations, 0)`. Children
contribute only when `aggregateAllocationForTarget` is true. Spending and carryover do not affect
this formula.

Monthly spending uses the same formula. It also subtracts positive carryover when both carryover
strategies are ALL and `useAllocatedAmountOnly` is not true.

SAVINGS supports fixed, dynamic, and no-deadline demand through
[savings-target.ts](../../src/budget/savings-target.ts). The preview requires a stored creation
timestamp and an explicit calculation timezone. [Savings Target Schedules](target-schedules.md)
defines the formulas and restrictions.

Eligibility excludes income categories, SKIP computation, FUND_OVERRUNS accumulation,
selected-period snoozes, absent targets, and nonpositive target amounts. Other target formulas
remain unsupported.

Distribution is sequential. With partial funding enabled, each category receives the lesser of its
request and the remaining pool. Otherwise, unaffordable requests are skipped and later categories
remain eligible. Distribution is not proportional.

The implementation lives in [target demand](../../src/budget/target-demand.ts),
[allocation model](../../src/budget/allocation-model.ts), and
[target preview](../../src/budget/auto-allocation.ts).

## Historical And Smart Allocation

Historical averages divide positive amounts by the number of positive months, with integer
truncation. Allocation and spending use separate sums and counts. Native strategies use one or three
latest saved periods before the actual current month. Calendar gaps do not create zero months.

`allocations averages` exposes this arithmetic for an explicit reference month. It does not execute
historical allocation. Native replacement uses an absolute-amount clamp that needs separate support.

Smart allocation processes overspending, upcoming obligations, then targets. Once a category
receives a positive funding result, later phases skip it, including after partial funding (51857,
51862). Target demand stays at its original value throughout the phases.

Upcoming membership comes from `TRANSACTIONS.data.upcomingTransactions`, filtered by `targetToId`.
Demand is `upcomingAmount - availableAmount` only when matching entries exist and that difference is
positive. The constructor neither sums preview amounts nor generates recurring occurrences.

Smart priority uses negative availability, earliest matching due date, upcoming demand, target
weekday, then target day. Due dates use the runtime system timezone without a selected-month filter.
[Smart Allocation](smart-allocation.md) records eligibility, ordering directions, and preview
limits.

The CLI implements the restricted empty-upcoming smart subset. Its phase results keep the original
target requests separate from overspending requests. They do not represent recalculated target
progress.

## Save Boundary

Direct allocation sets an absolute category amount. Its native batch writes:

1. Period `balances.<category>.allocatedAmount`, `updatedAt`, and `lastUpdateChangeSource=USER`.
2. Category stash `data.historicalAllocations.<YYYY-MM>`.
3. Budget `allocationHistory.<historyId>` and `changeSource=USER`.
4. A save marker with server creation time and expiry.

Manual history stores before and after allocations. Direct auto-allocation uses AUTO_ALLOCATION.
Linked allocation and reallocation history have different amount meanings. Native bulk allocation
saves separate category batches, not one atomic bulk operation.

The direct writer returns before server confirmation. Its budget-root update prevents automatic
resend through the native coordinator. [Allocation Persistence](allocation-persistence.md) records
the recovery rules and separate undo operations. Neither a successful writer return nor a marked
undo entry proves that all corresponding writes completed.

Cleared, completed zero-based income adds to allocation resources (51745). Category funding is a
separate effect. Linked income can have empty `extras` and a matching allocation history entry.

The CLI does not save allocation previews. Later-period effects, complete linked/surplus effects,
retry identity, and protection against concurrent changes still need evidence. Use the
[write validation procedure](README.md#validate-new-writes) before implementing those saves.
