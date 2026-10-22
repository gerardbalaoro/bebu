# Savings Target Schedules

This reference defines the recovered SAVINGS demand for a deterministic CLI preview. It is for
maintainers extending [target-demand.ts](../../src/budget/target-demand.ts). Production code was not
changed during this investigation.

The fixed and dynamic deadline formulas are resolved. An offline instruction-slice experiment
supports their arithmetic and month counts. Timestamp conversion, model construction, and server
effects were not executed as a complete app. These results do not establish full native parity.

## Evidence Identity

All function and structure numbers refer to the public Beyond Budget web artifact inspected on
2026-10-23:

- Module: `4ef2928daa118d1b3431.wasm`, 33,069,046 bytes.
- Module SHA-256: `1c9b9bb1e7699c7080cba0095485e04772285c200ab458f57346161d233a9eea`.
- Decoded WAT: 221,862,483 bytes.
- WAT SHA-256: `dfa66d5044ec6cc1a31f53c6437d325d34d2190fc475f2894c899c474f7c6c9c`.
- Decoder and slice compiler: `wasm-tools 1.262.0`. Execution: Node.js `24.22.1`.

Both source hashes matched during this investigation. Existing REA provider and input-size failures
were reused, without repeating those operations. This investigation produced no new REA evidence
records. Its evidence consists of indexed WAT instructions and local slice execution.

The following offsets allow extraction from the identified module. Offsets identify binary function
bodies, including local declarations and excluding the size prefix.

| Function | Body Offset | Body Bytes | Responsibility                          |
| -------- | ----------: | ---------: | --------------------------------------- |
| 48558    |    21068397 |       3847 | Target decoder and omission defaults    |
| 48561    |    21073205 |        359 | Target field names                      |
| 48807    |    21190877 |        292 | Period field names                      |
| 49209    |    21510690 |       4854 | Category model and target-type dispatch |
| 49244    |    21525635 |       3108 | Spending/debt schedule dispatch         |
| 49245    |    21528745 |       1351 | Deadline and no-deadline arithmetic     |
| 49248    |    21530353 |         90 | Calculation result fields               |
| 49249    |    21530445 |        269 | Calculation result defaults             |
| 49250    |    21530716 |        151 | Selected-month snooze                   |
| 51908    |    22319442 |         66 | Target allocation amount callback       |
| 51912    |    22319697 |         99 | Target-only eligibility                 |
| 53449    |    22653885 |        181 | Calendar period difference              |
| 53507    |    22664985 |         50 | Timestamp conversion                    |

## Inputs And Call Path

Function 48080 identifies target types: `SPENDING=0`, `GET_OUT_OF_DEBT=1`, `SAVINGS=2`, and
`ON_GOING_SAVINGS=3`. Function 49209 dispatches those types separately. GET_OUT_OF_DEBT enters 49244
with allocated-only enabled. SAVINGS enters 49245 directly.

Field names come from formatters 48561, 48816, 48807, and 44708. Decoder 48558 supplies the listed
target defaults. Explicit null and omission are separate cases.

| Stored Input                            | Native Field          | Meaning / Omission Default                             |
| --------------------------------------- | --------------------- | ------------------------------------------------------ |
| `target.type`                           | `7044.4`              | SPENDING                                               |
| `target.useAllocatedAmountOnly`         | `7044.5`              | null, unused by SAVINGS                                |
| `target.createdAt`                      | `7044.6`              | Timestamp, defaults to `Timestamp.now()` through 22157 |
| `target.endAt`                          | `7044.7`              | Nullable Timestamp, defaults to null                   |
| `target.repeatIntervalMonths`           | `7044.8`              | Nullable integer, defaults to null                     |
| `target.carryOverStrategy`              | `7044.9`              | ALL, unused by SAVINGS                                 |
| `target.period`                         | `7044.10`             | null, unused by SAVINGS demand                         |
| `target.snoozeSchedule`                 | `7044.14`             | Empty map                                              |
| `target.amount`                         | `7044.15`             | Signed i64, defaults to zero                           |
| `target.dynamicSavingsTarget`           | `7044.16`             | Boolean, defaults to false                             |
| `category.carryOverStrategy`            | `7045.16`             | Controls carryover in available funds                  |
| `category.aggregateAllocationForTarget` | `7045.21`             | Enables positive direct-child allocations              |
| Selected `period.yearMonth`             | `7048.5`              | Calendar month and snooze-map key                      |
| Selected balance fields                 | `7002.4` through `.8` | Spent, allocated, carryover, upcoming, other           |

The SAVINGS call in 49209 supplies:

```text
G = sum(max(child.allocatedAmount, 0)) if aggregation is enabled else 0
A = balance.allocatedAmount + G
F = available(balance, category.carryOverStrategy) + G

available = allocatedAmount + otherAmount - spentAmount
if category.carryOverStrategy != NONE:
    available += carriedOverAmount

result = function49245(target, F, A, selectedPeriod, dynamicSavingsTarget, currency)
```

Function 48815 calls 48814, then subtracts spending. This is the available-funds calculation used by
SAVINGS, even when the target's allocated-only flag is true. Positive and negative carryover both
enter `F` when category carryover is ALL. Target carryover does not control this branch.
`upcomingAmount` does not enter either `F` or `A`.

Only positive allocations from computed direct children enter `G`. Child spending, other amounts,
and carryover do not enter `G`. Hierarchy construction remains outside the proposed flat CLI subset.

The demand result follows `6928.0 → 44701 → 7765.7`, named `pendingAllocationAmount` by 44708.
Callback 51908 reads that field and clamps it to zero. Display fields for expected allocation and
progress must not substitute for this demand.

## Calendar Counts And Timezone

Let `C` be the local date of `createdAt`, `L` the local date of `endAt`, and `P` the selected
month's first day. Function 49245 converts `period.yearMonth` through `17148 → 17473 → 16744(1)`. It
sets the creation date's day to one only when calculating elapsed months.

Function 53449 returns years, months, and days. Demand uses only `12 * years + months`. Its exact
whole-month count is:

```text
monthsBetween(a, b):
    n = 12 * (b.year - a.year) + b.month - a.month
    if n > 0 and b.day < a.day: return n - 1
    if n < 0 and b.day > a.day: return n + 1
    return n

E = monthsBetween(firstDay(C.month), P) + 1
T = monthsBetween(C, L) + 1
R = max(monthsBetween(P, L), 1)
```

`E` is the elapsed count. `T` is the total count. `R` is the dynamic divisor. The dynamic divisor
has no extra `+1`. The day of creation can reduce `T`: January 15 through April 14 gives `T=3`.
January 15 through April 15 gives `T=4`. January 31 through February 29, 2024 gives `T=1`.

There is no daily proration, week count, or division by a fixed number of days. The selected day is
always one. Changing the actual day within the selected month does not change deadline demand when
the stored inputs and timezone remain fixed.

Timestamp conversion follows `53507 → 53346 → 53371 → 53390`. The timezone supplier follows
`53348 → 17439 → 17368`, which invokes JSJoda `systemDefault()` through imports 678, 677, and 676.
Initializer 83723 binds that supplier to global 92513. This path uses the runtime's system timezone.
It does not read the user's saved budget timezone.

The demand formula has no current-clock operand when `createdAt` and `endAt` are present. However,
an omitted `createdAt` gets the current time during decoding. Status computation also reads the
clock through `53121 → 53343 → 53342 → 53347 → 2333`. JavaScript imports 65 and 66 call `new Date()`
and `getTime()`. A deterministic CLI must make timestamp dates and timezone explicit.

## Exact Demand Rules

These formulas assume an eligible positive target amount `M` and no arithmetic overflow. Division
truncates toward zero through 2574. All numerators in these divisions are nonnegative, so truncation
equals floor. Native addition, subtraction, and multiplication use wrapping signed i64 arithmetic.

### Fixed Deadline

When `endAt` exists and `dynamicSavingsTarget=false`:

```text
Q = floor(M / max(T, 1))
goal = M if E == T else Q * max(min(E, T), 0)
D = max(goal - F, 0)
```

This is a cumulative catch-up goal. Allocation `A` is not subtracted separately. It already
contributes to `F`.

The full-target correction applies only when `E == T`. It does not apply whenever `E >= T`. After
that month, the goal returns to `Q * T` for a positive `T`. A division remainder can therefore make
the later goal smaller. This unusual boundary is present in the extracted instructions and passed
the literal execution cases.

Before creation, the cumulative goal is zero. Negative available funds can still produce positive
demand. There is no separate pre-creation exclusion in this branch.

### Dynamic Deadline

When `endAt` exists and `dynamicSavingsTarget=true`:

```text
remaining = max(M - F, 0)
Q = floor(remaining / R)
D = max(Q - A, 0)
```

Current allocation contributes to `F` and is subtracted again as `A`. Positive child allocations
also enter both operands. This second subtraction is native behavior. It must not be removed as an
apparent double count.

The last month and overdue months use `R=1`. The creation count affects display calculations but
does not enter this demand. A negative `A` can produce positive demand even when `F >= M`.

### No Deadline

When `endAt` is null, demand is `max(M - F, 0)`. The dynamic flag does not select another formula.
The same function separately estimates an end date and average allocation. Those estimates use
elapsed months, available funds, the clock, and currency/country heuristics. Their complete behavior
remains outside this contract. The recovered demand is not a historical-allocation average.

### Literal Examples

All amounts are integer minor units. These results are offline slice outputs, not live budget
fixtures. `F` and `A` already include the inputs defined earlier.

| Case                                | Inputs                     | Demand |
| ----------------------------------- | -------------------------- | -----: |
| Fixed first month                   | `M=100, T=3, E=1, F=0`     |     33 |
| Fixed catch-up                      | `M=100, T=3, E=2, F=25`    |     41 |
| Fixed final count                   | `M=100, T=3, E=3, F=0`     |    100 |
| Fixed after final count             | `M=100, T=3, E=4, F=0`     |     99 |
| Before creation with negative funds | `M=100, T=3, E=0, F=-20`   |     20 |
| Dynamic current allocation          | `M=100, R=2, F=20, A=20`   |     20 |
| Dynamic last month                  | `M=100, R=1, F=20, A=20`   |     60 |
| Dynamic negative allocation         | `M=100, R=2, F=120, A=-20` |     20 |
| No deadline                         | `M=100, F=-20`             |    120 |

For creation on January 15 and deadline on April 14, 2026, fixed demand with `M=100, F=0` is 100 in
March and 99 in April. Moving the deadline to April 15 makes March demand 75.

## Eligibility, Snoozing, History, And Repeats

Target-only eligibility still follows 51912 and 44704. It excludes SKIP computation, INCOME,
FUND_OVERRUNS, SNOOZED, an absent/default target, and `amount <= 0`. SAVINGS does not require a
period enum, weekday, or deadline in this predicate. An elapsed deadline does not itself exclude the
target from allocation.

With a deadline, 49209 can assign ELAPSED when the deadline precedes its clock-derived instant and
progress is below one. Otherwise it selects PENDING_ALLOCATION, IN_PROGRESS, or REACHED. These
progress values use f32. They are not substitutes for integer demand or new eligibility conditions.
Snoozing overrides the computed status through 49250.

**Correction to the earlier target report:** 49250 reads `snoozeSchedule[period.yearMonth]`, not the
period document ID. Formatter 48807 identifies `7048.5` as `yearMonth` and `7048.4` as `id`. A true
month entry returns SNOOZED. An absent or false entry preserves the previous status.

The SAVINGS path reads no `historicalAllocations` map. Past financial state enters through the
selected stored balance, including carryover. Summing historical allocations again would introduce
another amount that this call path does not use. Carryover production remains a separate unresolved
server/client boundary.

Neither 49245 nor the SAVINGS branch in 49209 reads `repeatIntervalMonths`. The calculated SAVINGS
model receives null repeat, period, weekday, day-of-month, and month-of-year fields. Its allocation
sort keys are therefore null, even if irrelevant schedule fields exist in the stored DTO.

A bounded module-wide search found `struct.get 7044 8` only in 48557, 48561, 48562, 48563,
and 49244. Those sites encode, format, compare/hash, or forward the repeat field. This search does
not establish how another workflow advances a target or updates its stored deadline. Repeat
lifecycle behavior remains unsupported.

## Shared Helper Boundary

The CUSTOM branch of 49244 also calls 49245. It forces dynamic=false and supplies a different funds
operand:

```text
carry = max(carriedOverAmount, 0) if not allocatedOnly
        and target.carryOverStrategy == ALL
        and category.carryOverStrategy == ALL else 0
Fcustom = allocatedAmount + G + carry
```

Its second amount argument is raw current allocation. That argument does not affect fixed deadline
demand. Spending and other amounts do not enter `Fcustom`. GET_OUT_OF_DEBT forces allocated-only, so
its CUSTOM funds operand omits carryover. These are shared-helper findings, not a claim that debt
categories have ordinary SAVINGS balances.

WEEKLY, BI_MONTHLY, EVERY_TWO_MONTHS, and ANNUALLY select other 49244 branches. Their full contracts
were not investigated here. Do not apply SAVINGS day/week rules to those schedules.

## Proposed CLI Boundary

This table separates recovered rules from proposed implementation limits. The current CLI still
rejects SAVINGS. Every new calculation must belong in CLI code, not generated agent instructions.

| Input Condition                                            | Recovered Rule                    | Proposed CLI Handling                                   |
| ---------------------------------------------------------- | --------------------------------- | ------------------------------------------------------- |
| Positive SAVINGS amount, explicit creation/deadline, fixed | Fixed formula                     | First preview extension                                 |
| Same inputs, dynamic=true                                  | Dynamic formula                   | Same extension, separate branch                         |
| `dynamicSavingsTarget` omitted                             | false                             | Decode this stable default                              |
| `createdAt` omitted                                        | Decode-time current Timestamp     | Reject for deterministic preview                        |
| Deadline before creation                                   | Arithmetic still runs             | Reject as an explicit CLI restriction                   |
| Null deadline                                              | Full shortfall                    | Later demand-only extension; omit unsupported forecasts |
| Category carryover ALL                                     | Include signed carryover          | Support with explicit complete balance/defaults         |
| Category carryover NONE                                    | Ignore carryover                  | Support                                                 |
| Target carryover / allocated-only                          | Ignored by SAVINGS                | Keep separate from monthly-spending logic               |
| Month snoozed or other eligibility exclusion               | Ineligible                        | Return the established exclusion                        |
| Repeat interval present                                    | Unused in this demand path        | Reject until repeat lifecycle is understood             |
| Parent/child categories                                    | Positive direct-child allocations | Retain the existing hierarchy rejection                 |
| Unknown runtime timezone                                   | Local dates are uncertain         | Require an explicit compatible timezone                 |
| Unsafe amount/intermediate                                 | Native wraps signed i64           | Reject under an explicit CLI integer policy             |

The initial CLI used the period document ID for snoozing. A synthetic call returned eligible demand
100 despite `snoozeSchedule["2026-10"]=true`. The corrected demand input is `yearMonth`, and the
preview passes the validated selected month. A regression test uses different document and month
keys to preserve this distinction.

For the subsequent SAVINGS extension, the current schemas need `createdAt`, `endAt`,
`dynamicSavingsTarget`, and `repeatIntervalMonths`. They currently discard these fields.
`target-demand.ts` also retains only allocated and carryover amounts from the supplied balance. It
needs spent and other amounts for `F`, plus an explicit month and timestamp conversion policy.
SAVINGS order keys must come from its calculated null schedule fields.

The preview currently checks the current month in the saved user timezone. That does not establish
the system timezone used by native timestamp conversion. Retain the current flat/latest-month
restrictions while adding an explicit calculation timezone. Preserve the existing ongoing and
monthly-spending formulas as separate branches.

## Offline Experiment And Remaining Evidence

The money experiment copied instruction ranges from 49245 into a small WASM module:

- Fixed: local WAT lines 383–413 and 418–446.
- Dynamic: lines 278–306, with the already-clamped remaining count supplied as input.
- No deadline: lines 203–216, with stack cleanup for unrelated result fields.

It retained native integer operations, branches, `select`, and the target amount field load. Minimal
GC target structs replaced runtime types. The division helper used `i64.div_s` because these slices
have positive divisors. Native 2574's zero and negative-one exception cases cannot occur within this
bounded input contract.

The date experiment retained the complete body of 53449, remapped its types/functions, and supplied
calendar helpers for epoch days, month lengths, and month addition. It compared the returned
year/month count with an independent reconstruction. It did not execute timestamp parsing or
system-timezone conversion.

Both slice modules compiled and passed `wasm-tools validate --features all`. Node.js execution
produced zero mismatches across:

- 46,000 money comparisons, including negative amounts and signed-i64 boundaries.
- 8,100 date comparisons across 1999, 2000, 2023, 2024, 2026, and 2100.
- 14 literal money cases, 7 literal date cases, and 5 combined date/demand cases.

The integer reconstruction used `BigInt.asIntN(64, ...)` after native wrapping operations. The CLI's
safe-integer rejection policy is different. For example, native no-deadline arithmetic with
`M=2^63-1` and `F=-1` wraps negative, then returns zero.

Remaining evidence needed for broader support includes exact timestamp/timezone integration, repeat
lifecycle, no-deadline forecast heuristics, other schedule branches, and independent native
read-only fixtures. No browser, private budget, financial write, production edit, or commit was
used. Static client code and synthetic slices cannot establish carryover propagation, server
effects, or complete native equivalence.
