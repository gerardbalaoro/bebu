# Smart Allocation Inputs And Priority

This reference supports a deterministic CLI smart-allocation preview. The recovered client uses
stored upcoming transaction previews and stored period balances. Its category constructor does not
expand recurring transactions. Recreating future occurrences from canonical transactions is a
separate, unresolved contract.

The smallest safe extension is a preview for budgets with an empty upcoming map and zero upcoming
balances. The calculation belongs in CLI code. This investigation changed no production code or
existing tests and performed no financial writes.

## Evidence Identity And Scope

All function and structure numbers refer to the public Beyond Budget web build inspected on
2026-10-23:

- Module: `4ef2928daa118d1b3431.wasm`, 33,069,046 bytes.
- Module SHA-256: `1c9b9bb1e7699c7080cba0095485e04772285c200ab458f57346161d233a9eea`.
- Decoded WAT: 221,862,483 bytes.
- WAT SHA-256: `dfa66d5044ec6cc1a31f53c6437d325d34d2190fc475f2894c899c474f7c6c9c`.
- Slice compiler: `wasm-tools 1.262.0`. Slice runtime: Node.js `24.22.1`.

Both source hashes matched. Existing REA provider and input-size failures remained applicable and
were not repeated. This investigation produced no new REA evidence records. Static instructions
establish the client calculation. Offline execution supports selected arithmetic, not complete
native behavior, synchronization, server effects, or successful allocation saves.

Binary offsets below include local declarations and exclude the function-body size prefix. They
allow independent extraction from the identified module.

| Function | Body Offset | Body Bytes | Responsibility                                |
| -------- | ----------: | ---------: | --------------------------------------------- |
| 48967    |    21302041 |        905 | Transaction preview field names               |
| 49209    |    21510690 |       4854 | Category membership, amounts, and due dates   |
| 49229    |    21520555 |       1473 | Category constructor arguments                |
| 49456    |    21616608 |        466 | Transaction stash wrapper decoder             |
| 49464    |    21618412 |       1477 | Transaction data decoder                      |
| 50331    |    21865287 |       7900 | Budget model input selection                  |
| 50348    |    21880361 |        779 | Stash stream selection                        |
| 51853    |    22304109 |       1618 | Capture budget model and select strategy      |
| 51857    |    22308345 |       1125 | Smart eligibility, ordering, and phases       |
| 51862    |    22314594 |        975 | Distribution and successful-category tracking |
| 51906    |    22319315 |         59 | Overspending request                          |
| 51907    |    22319375 |         66 | Upcoming request                              |
| 51908    |    22319442 |         66 | Target request                                |
| 52444    |    22514396 |        556 | Comparator selector order                     |
| 52445    |    22514953 |        112 | Overspending priority                         |
| 52446    |    22515066 |        117 | Earliest due-date priority                    |
| 52447    |    22515184 |         38 | Upcoming amount priority                      |
| 52048    |    22390185 |       1512 | Separate projected-transaction generator      |
| 51933    |    22331542 |       2339 | Separate surplus summary calculation          |

## Upcoming Membership And Amount

The source is the budget's `TRANSACTIONS` stash, specifically `data.upcomingTransactions`. The
completed-transaction map, canonical transaction collection, and selected period metadata are
separate inputs. Decoder 49464 defaults omitted maps to empty maps and omitted `trimmed` to false.
Those field defaults do not make a missing stash document a complete source.

The recovered path is:

1. Repository function 50348 selects `TRANSACTIONS` through 49816 and requests its stream
   through 51341.
2. Decoder 49456 places decoded `TransactionsData` inside wrapper `7052.4`. Decoder 49464 supplies
   the data fields.
3. Function 50347 combines that wrapper unchanged into `7056.7`.
4. Function 50331 reads `7056.7 → 7052.4 → 6850.4`, then captures it in `6910.10`.
5. Function 49229 passes that map as parameter 7 to category constructor 49209.
6. Function 49209 retains entries whose `TransactionPreviewDto.targetToId` equals the category's
   stored ID.

The category filter uses exact ID equality through 2674. It does not use `targetFromId`,
`extraTargetId`, account links, or a guessed category ID. Map keys survive the filter.

| Meaning                                           | Stored Input / Model Field                         | Native Slot         |
| ------------------------------------------------- | -------------------------------------------------- | ------------------- |
| Upcoming membership                               | `TRANSACTIONS.data.upcomingTransactions`           | `6850.4`            |
| Completed stash entries, separate from membership | `TRANSACTIONS.data.completedTransactions`          | `6850.5`            |
| Stash trimming flag                               | `TRANSACTIONS.data.trimmed`                        | `6850.6`            |
| Destination ID                                    | Preview `targetToId`                               | `6975.6`            |
| Preview amount, not summed by this constructor    | Preview `amount`                                   | `6975.9`            |
| Preview due timestamp                             | Preview `dueAt`                                    | `6975.12`           |
| Category ID                                       | Category `id`                                      | `7045.4`            |
| Selected-period upcoming amount                   | `balances[id].upcomingAmount`                      | `7002.7`            |
| Category available amount                         | Derived category `availableAmount`                 | `8269.11`           |
| Upcoming pending amount                           | Derived `upcomingOverview.pendingAllocationAmount` | `8269.42 → 7636.6`  |
| Upcoming due dates                                | Derived `upcomingOverview.dueDates`                | `8269.42 → 7636.10` |
| Original target demand                            | Derived `target.pendingAllocationAmount`           | `8269.34 → 7765.7`  |

Field names are cross-checked by 49466–49467, 48967, 48816, and 44684. The raw balance comes from
the selected period. Missing balance operands use the established zero defaults.

Let `M` be the filtered upcoming map, `U` the stored upcoming amount, and `A` category availability.
Functions 48814–48815 calculate availability with the category carryover strategy:

```text
A = allocatedAmount + otherAmount - spentAmount
if category.carryOverStrategy != NONE:
    A += carriedOverAmount

if M is nonempty and U > A:
    upcomingPending = U - A
else:
    upcomingPending = 0
```

Function 49209 performs the guarded subtraction and 44682 stores its result. It does not sum
`M.values.amount`. Neither `U > 0` nor a nonzero transaction amount is required.

For ordinary, nonoverflowing amounts:

|   A |   U | Matching Entries | Upcoming Pending |
| --: | --: | ---------------: | ---------------: |
|  20 | 100 |                0 |                0 |
|  20 | 100 |                1 |               80 |
| -20 | 100 |                1 |              120 |
| -20 |   0 |                1 |               20 |
| -20 |   0 |                0 |                0 |
| 100 | 100 |                1 |                0 |

These cases also passed against the extracted instructions. A raw upcoming balance alone cannot
establish upcoming demand. A zero upcoming balance alone cannot establish zero demand.

### Dates, Period, And Projection

Function 49209 creates one due date per matching map entry:

```text
matching = upcomingTransactions.filterValues(t => t.targetToId == category.id)
dueDates = matching.values.map(t => localDate(t.dueAt, runtimeSystemTimezone))
earliestDueDate = min(dueDates) if nonempty else 9999-12-31
```

Conversion follows `53507 → 53346/53371 → 53390`. The timezone supplier follows
`53348 → 17439 → 17368`, then JSJoda's `systemDefault()` import. The inspected path does not read
the user's saved timezone. [Savings Target Schedules](target-schedules.md) preserves the shared
clock and timezone evidence.

The constructor does not filter this map by selected month, current date, completed status, cleared
status, transaction type, recurrence frequency, or clone status. It trusts membership in the
upcoming bucket. It also does not shift `dueAt` for non-working days or generate additional
occurrences. Those properties can affect how another process populates the stash, but this
constructor does not apply them again.

`currentPeriodTransactionCount` uses the selected `period.yearMonth` to count matching due months.
It is a separate overview field, `7636.9`. That count does not restrict `dueDates`, map membership,
or the pending formula. An entry outside the selected month can therefore affect smart priority. Due
dates also affect priority when upcoming pending is zero.

Function 52048 separately creates projected transactions. Direct callers include 61480 and 63515.
The traced `50331 → 49229 → 49209` and `51853 → 51857 → 51862` paths do not call that generator.
This closes the local membership boundary. It does not explain all upstream recurrence processing or
establish when stored balances and stash entries become mutually current.

## Exact Destination Priority

Smart allocation uses comparator `52444.0`. Initializer 83723 binds its five selectors in this
order:

1. Available amount when negative, otherwise `Long.MAX_VALUE` (52445).
2. Minimum due date from the complete matching map, otherwise `9999-12-31` (52446 → 1172).
3. Signed upcoming pending amount, ascending (52447).
4. Target weekday ordinal, Monday through Sunday, with an absent value last (51913).
5. Target day of month, with an absent value last (51914).

More negative availability sorts first. With equal availability priority and due date, smaller
upcoming demand sorts first. Target amount and deadline are not additional comparator keys.
Historical allocation uses this same comparator. Target-only allocation uses only the final two
keys, so its result cannot substitute for a smart ordering result.

The native sort is stable: `1169 → 2785 → 1389 → 1391`. Equal keys retain the input sequence. The
input follows the group/category model order described in
[Allocation Rules](allocation-contract.md). Equal stored-order ties still require a known original
sequence. Sorting IDs introduces a CLI policy.

This comparator orders destination categories. Surplus-source selection belongs to a separate
workflow. Its priorities do not replace these five keys.

## Snapshot Timing And Target Overlap

Function 51853 retrieves a budget model through `50283 → 53537 → 53539`, then supplies it to 51857.
Function 51857 flattens categories, filters them once, sorts them once, and retains that list for
all three phases. It does not rebuild category models after individual saves.

This is one captured model, not proof of an atomic database snapshot. The repository combines
separate source streams. The inspected path does not establish a common backend read version.

Smart eligibility is broader than target-only eligibility:

```text
eligible = category.computation != SKIP
    and category.type != INCOME
    and (
        (validNativeTarget(category.target) and target.status != SNOOZED)
        or A < 0
        or upcomingPending > 0
    )
```

`validNativeTarget` is function 44704. It checks the target sentinel, positive amount, and required
schedule fields. Smart eligibility does not exclude `FUND_OVERRUNS`. The target-only predicate 51912
does exclude it. The target formulas and native month-key snoozing remain in
[Savings Target Schedules](target-schedules.md).

For supported amounts, the captured demands are:

```text
overspendingRequest = -A if A < 0 else 0       # 51906
upcomingRequest = max(upcomingPending, 0)     # 51907
targetRequest = max(originalTargetPending, 0) # 51908
```

There is no residual-target subtraction between phases. A successful allocation suppresses the
category's entire later request, including after partial funding. It does not combine demands with
sum or maximum, and it does not recalculate target demand from the new allocation.

The following pseudocode assumes successful allocation callbacks. It preserves the distribution
rules in 51862. Callback success does not prove server confirmation, as
[Allocation Persistence](allocation-persistence.md) explains.

```text
remaining = budget.pendingAllocationAmount
if ignoreAvailable:
    remaining = Long.MAX_VALUE
fundedIds = empty set

for phase in [overspendingRequest, upcomingRequest, targetRequest]:
    for category in capturedSortedCandidates:
        if category.id in fundedIds: continue
        if remaining <= 0: break
        request = phase(category)
        if request > remaining and not allowPartial: continue
        delta = clamp(request, 0, remaining)
        if delta <= 0: continue
        proposedAmount = category.originalAllocatedAmount + delta
        # Native path saves proposedAmount here.
        # Only a successful callback result performs the following updates.
        fundedIds.add(category.id)
        remaining -= delta
```

For a category with availability `-20`, upcoming pending `120`, and target pending `200`, successful
overspending funding of `20` prevents both later phases. With partial funding enabled and a pool of
`10`, funding of `10` also prevents both later phases.

Skipped or failed requests do not mark the category. A category admitted through overspending can
reach the target phase even with a snoozed target. For example, an unaffordable overspending request
can be skipped while a smaller original target request remains affordable. This is why a planner
cannot reuse target-only eligibility as its sole smart predicate.

The partial and ignore-pool settings enter the smart continuation as booleans `6248.14` and
`6248.13`. The captured pool is `8453.16`. Overwrite is not part of this smart distribution path.
The authenticated-user setting sources and defaults remain in
[Allocation Rules](allocation-contract.md).

### Surplus Forecast Boundary

Function 51933 returns a `SurplusMoneySummary`, with totals and coverage entries named by 45665. Its
calculation includes separate coverage and overlap inputs. That summary does not prove allocation
saves. Smart distribution instead reaches the direct allocation writer through 51862 → 50286.
Neither surplus coverage totals nor hypothetical projected transaction amounts replace smart
demands. This investigation does not recover the complete surplus forecast or surplus transfer
contract.

## Offline Execution Results

The experiment extracted the pending expression from 49209 and the complete selector bodies from
51906, 51907, 51908, 52445, and 52447. It retained their branches, field reads, comparisons, and
signed arithmetic. Minimal GC structures replaced application types and boxing metadata.

`wasm-tools parse` compiled the slice and `wasm-tools validate --features all` accepted it. Node.js
ran 7,018 differential comparisons against an independent `BigInt` reconstruction. All passed:

- 363 pending comparisons: 11 availability values × 11 upcoming values × map sizes 0, 1, and 3.
- 6,655 selector comparisons: 11 values for each of availability, upcoming pending, and target
  pending, across five selectors.
- Ten additional literal assertions passed, including the six membership/amount cases listed
  earlier.

The 11 amounts were `[-2^63, -(2^53+1), -100, -1, 0, 1, 20, 100, 2^53+1, 2^63-2, 2^63-1]`. The
reconstruction used `BigInt.asIntN(64, ...)` for native subtraction and negation.

Overflow results matter: `U=Long.MAX_VALUE` and `A=-1` produce `Long.MIN_VALUE` pending. The
upcoming request selector then returns zero. Negating `Long.MIN_VALUE` in the overspending selector
also returns `Long.MIN_VALUE`. The CLI's safe-integer rejection is a separate policy.

Two initial slice builds failed because of type-index remapping errors. Corrected remapping
preserved field indices and passed both validation and execution. No unavailable provider or
oversized-module operation was retried.

The experiment did not run original map/string implementations, timestamp conversion, recurrence,
coroutines, allocation saves, or Firebase. Membership, date construction, ordering stability, and
phase overlap remain static findings. No full smart-allocation runtime fixture exists.

## Smallest Safe CLI Extension And Remaining Evidence

The next change is a pure smart-preview planner, connected to the existing allocation model and
settings. It can reuse supported target arithmetic after separating that arithmetic from target-only
eligibility. It must retain `executionSupported: false`.

A conservative first scope has these CLI restrictions:

- Existing flat, ordinary, unlinked, nonarchived, zero-based categories with unambiguous stored
  order.
- The existing current/latest-period identity checks and safe-integer policy.
- Supported monthly spending or ongoing savings targets, or no target.
- No selected-month snoozes or `FUND_OVERRUNS` until their smart-specific paths are implemented.
- Ignore-pool disabled.
- A successfully read `TRANSACTIONS` stash with an empty upcoming map and `trimmed=false`.
- Zero selected-period `upcomingAmount` for every category.

The empty map removes all due-date priority inputs and upcoming requests. The balance guard rejects
inconsistent-looking inputs. This guard is a deliberate CLI restriction, not a native requirement.
Missing stash documents, omitted read results, or a trimmed snapshot cannot serve as proof of
emptiness. The first planner still needs overspending-first ordering and the successful-category
exclusion rule. It cannot call target-only preview after altering balances.

The static client calculation for nonempty upcoming maps is now bounded. It requires complete map
membership, each matching `targetToId` and `dueAt`, selected-period `U` and balance operands, and a
compatible explicit calculation timezone. It does not require summing projected transaction amounts.
A later CLI extension can consume these inputs without claiming how upstream recurrence created
them.

| Remaining Boundary                            | Searched Evidence                                          | Missing Evidence Or Required Input                                                    |
| --------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Stash completeness and freshness              | Decoders 49456/49464, stash streams 50348, model 50331     | Meaning of trimming for upcoming entries and synchronized period/stash fixtures       |
| Calendar boundary equivalence                 | Conversion 53507, timezone supplier 53346/53348/17368      | Executed timezone and DST boundary fixtures using the native conversion path          |
| Future recurrence from canonical transactions | Separate generator 52048 and direct callers 61480/63515    | Full occurrence generation, exceptions, persistence timing, and backend effects       |
| Ambiguous priority ties                       | Stable sort and model base ordering                        | Original collection sequence where stored orders tie                                  |
| Snoozed or special categories in smart        | Broader filter in 51857 and original-demand callback 51908 | CLI separation of raw target demand from target-only eligibility and focused fixtures |
| Successful writes and concurrent updates      | Captured model and per-category writer calls               | Authorized native mutation fixtures, backend effects, and concurrency behavior        |

These boundaries do not prevent the restricted preview. They prevent a claim of full native-app
parity or a deterministic future forecast reconstructed solely from canonical transaction records.
