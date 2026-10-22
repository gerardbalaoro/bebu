# Recovered App Structure

This reference preserves the native structure and logic useful for source reconstruction and CLI
work. The layers describe observed responsibilities, not recovered Kotlin source directories.
Function and structure numbers apply only to the build identified in
[Allocation Rules](allocation-contract.md#evidence-identity).

## Application Layers

| Layer              | Recovered Structure                                                                        | Evidence Limit                                                             |
| ------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Interface          | Kotlin/Compose application, canvas rendering, Compose resource bundles, WebGL2 requirement | Original screen source is not recovered                                    |
| JavaScript bridge  | WASM loader and Kotlin interop with Firebase Auth, App Check, and Firestore                | An exposed SDK function does not prove use by a particular workflow        |
| Stored data        | Serializable DTOs with field names, enums, and omission defaults                           | Stored DTOs differ from calculated display models                          |
| Model construction | Budget, group, category, balance, and target models derived from snapshots                 | Some hierarchy and visibility rules remain unresolved                      |
| Domain services    | Eligibility, allocation distribution, transaction effects, and reallocation                | Indirect callbacks and coroutine state complicate control flow             |
| Persistence        | Document updates, increment transforms, history, and batch markers                         | Client code does not establish backend triggers or complete retry behavior |

The app module uses WASM GC structures and exception handling. Its JavaScript bridge requests string
builtins. A successful WAT decode preserves instructions, but does not recover original Kotlin
files, comments, local names, or project configuration.

## Stored Types And Calculated Models

DTO means the representation used for stored data. Serializer descriptors and formatter functions
expose names that identify otherwise numbered structure fields.

| Stored Type          | WASM Structure | Relevant Mapping                                                                          |
| -------------------- | -------------- | ----------------------------------------------------------------------------------------- |
| BudgetDto            | 7066           | Available periods, stash identifiers, allocation history, budget type                     |
| GroupDto             | 7018           | Field 6 is stored order; field 12 is group type                                           |
| CategoryDto          | 7045           | Field 6 is order; field 21 is aggregate target allocation                                 |
| TargetDto            | 7044           | Field 15 is target amount; schedule and carryover remain separate fields                  |
| PeriodDto            | 7048           | Fields 9/10 are allocation resource/carryover; field 11 is balances                       |
| BalanceDto           | 7002           | Fields 4–8 are spent, allocated, carried-over, upcoming, and other amounts                |
| UserDto / ConfigDto  | 7047 / 6957    | User field 11 is settings; settings fields 69/70/82 control overwrite/partial/ignore-pool |
| AllocationHistoryDto | 7084           | Identity, category/account/period links, amounts, source, status, and timestamps          |

The group/category stash contains both `data.groups` and `data.categories` (49322, 49330). Balance
lookup uses the category's stored ID. Child lookup uses the parent's map key (49209, 49229).
Replacing a missing ID with the map key can therefore change native behavior.

Calculated category model 8269 stores allocated amount in field 9 and order in field 19. Group model
8038 stores allocated amount in field 14 and type in field 26. Budget model 8453 stores pending
allocation in field 16. These fields are derived views, not additional document paths.

## Model Construction

Function 50331 assembles the budget model from stored snapshots:

1. Group raw categories by `parentCategoryId`.
2. Select top-level entries with the matching group, no parent, and `deleted=false` (49228).
3. Build category models and direct child models (49229, 49209).
4. Sum signed allocations for COMPUTE categories into each group.
5. Sum group allocations, excluding INCOME groups.
6. Calculate the remaining pool and construct display models.

Aggregation precedes some archive/display filters. Summing only visible or target-eligible
categories can understate allocated funds. The inspected child path attaches one level, not an
arbitrary recursive tree. Target child aggregation counts positive child allocations. Budget
aggregation counts signed allocations.

[Allocation Rules](allocation-contract.md) preserves the pool formula, omission defaults,
eligibility, priority, and supported target calculations. Native money arithmetic uses signed 64-bit
integers. Nearby floating-point calculations can describe progress indicators rather than money.

## Direct Allocation Flow

The manual entry uses source MANUAL (51851). Direct auto-allocation adds a funded delta to the
existing allocation and uses source AUTO_ALLOCATION (51916).

The save chain is `50286 → 50287 → 50304`. It captures the repository, budget, category, period,
absolute new amount, and source through a coroutine closure. The coroutine wrapper is not a
Firestore read transaction.

Function 50304 creates one write batch. It updates the period balance, category allocation history,
budget history, and save marker. The selected period path, model period ID, and model month must
agree.

The writer starts the commit coordinator without awaiting server completion. Its budget-root update
excludes this batch from automatic resend. [Allocation Persistence](allocation-persistence.md)
records the completion and recovery paths.

For an INCOME category, the same writer also sets `allocationAmount` to the new amount plus other
income-category allocations. This branch is absent for ordinary expense categories.

History uses a generated ID. The batch marker uses a separate generated ID. The marker contains
server `createdAt` and client-calculated `expireAt`, 30 days later (44063, 44075). Native timestamps
use Firestore timestamp values, even when decoded JSON displays strings.

No version precondition appears in this direct writer. Native bulk allocation calls it once per
category, producing separate batches. A CLI commit with version checks or one whole-plan batch is an
implementation choice, not recovered native behavior.

## Allocation History Semantics

Function 48335 maps the history fields. Function 50296 constructs entries and 50297 persists them.
The recovered sources are MANUAL, AUTO_ALLOCATION, CREDIT_OR_REFUND, MONEY_REALLOCATION,
LINKED_CATEGORY, and SYSTEM (46073).

| Source             | Identity And Links                                                       | Amount Meaning                                        |
| ------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| Direct manual/auto | Generated history ID, category ID, empty account and linked-category IDs | Before and after category allocations                 |
| LINKED_CATEGORY    | Transaction ID, linked-category ID, account ID, empty category ID        | Before is zero; after is transaction amount           |
| MONEY_REALLOCATION | Transaction ID, source category, destination as linked category          | Before is source allocation; after is transfer amount |

A display model derives `changeAmount = afterAmount - beforeAmount`. That expression does not make
all history sources ordinary before/after balance records.

For a direct non-income allocation, let `R` be the previous pool, `A` the old allocation, and `N`
the new allocation. Function 50296 calculates `R2 = R - (N - A)` and `O = max(-R2, 0)`:

| Condition, In Evaluation Order  | Status    |
| ------------------------------- | --------- |
| `O > 0` and `R >= 0`            | CAUSED    |
| `R < 0` and `R2 + 1 <= R`       | INCREASED |
| `R < 0`, `R2 > R`, and `O == 0` | FIXED     |
| `R < 0` and `R2 > R`            | DECREASED |
| Otherwise                       | NONE      |

NONE stores an overallocation amount of zero, even with an existing shortfall. A missing pool,
income category, or empty category sentinel bypasses this assessment.

Undo subtracts the recorded change from the current allocation in the history period (50281). The
direct writer creates SYSTEM history. A separate asynchronous update marks the original entry
undone. The repository has no already-undone guard. History deletion (50292) deletes only the entry.
Server completion order and recovery from partial undo remain unresolved.

## Linked And Surplus Allocation

The linked predicate requires completed, cleared, `autoAllocateIfCapable`, a non-null version, a
nonblank linked category, GENERIC_ACCOUNT target type, and CATEGORY linked type (51849). Source and
destination linked IDs must differ (51847). This predicate does not test `autoAllocateIfIncome`.

Function 51844 updates allocation with an increment transform. For ordinary linked income, addition
preserves the amount and removal negates it (51744, 51728, 14314). Updates remove stored effects,
then add replacement effects in one batch. Linked history uses a separate budget update (52084,
50271). Unclearing reverses allocation but leaves existing history on the inspected client path.

[Linked Income Allocation](linked-allocation.md) records the bounded lifecycle and write set. The
native inflow handler changes either the raw cleared balance or the uncleared balance (51729).
Account history changes only for completed, cleared income (51731). General preview eviction,
cross-period context, and server effects remain unresolved.

Surplus allocation calls transaction creation through
`51854 → 51867 → 51905 → 51915 → 51864 → 51856 → 50911 → 50902 → 50916`. Function 50902 negates the
supplied transfer amount. After the transaction call returns, 51856 writes separate
MONEY_REALLOCATION history.

Reallocation persistence dispatches period changes, transaction stashes, transaction collections,
and source/destination historical allocations (51763, 51767, 51714, 51720, 51769, 51770). Two direct
category updates do not reproduce this workflow.

## Historical Replacement And Open Boundaries

Historical distribution has a distinct replacement rule (51858):

```text
if current allocation != 0 and overwrite is false: skip
if desired allocation - current allocation > pool and partial is false: skip
new allocation = clamp(desired allocation, 0, pool)
after allocation callback returns: pool = pool - new allocation + current allocation
```

The clamp uses the desired absolute amount, not the requested increase. The CLI exposes historical
averages but does not implement this replacement workflow.

Remaining boundaries include backend carryover propagation, recurring projections, transfer
operation signs, complete reversal effects, and ambiguous-commit recovery.
[Savings Target Schedules](target-schedules.md) records the recovered deadline calculations. Static
client analysis cannot establish effects implemented only on the server.
