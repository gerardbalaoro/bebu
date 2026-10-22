# Allocation Persistence

This contract supports a future bounded manual allocation writer. It does not establish complete
native save parity or authorize live writes. The current safe extension is a manual allocation plan
with a complete write preview and `executionSupported: false`.

The recovered direct batch contains the known client writes. Two additional findings constrain a
writer: its native caller does not await commit completion, and its budget-root update disables the
coordinator's automatic resend path. Later-period carryover propagation remains unresolved.

## Evidence And Scope

This investigation used the public web-client artifact from 2026-10-22, offline on 2026-10-23:

- Module: `4ef2928daa118d1b3431.wasm`, 33,069,046 bytes; SHA-256
  `1c9b9bb1e7699c7080cba0095485e04772285c200ab458f57346161d233a9eea`.
- Decoded WAT: 221,862,483 bytes; SHA-256
  `dfa66d5044ec6cc1a31f53c6437d325d34d2190fc475f2894c899c474f7c6c9c`.
- Both hashes matched during this investigation. Function numbers and local line numbers below refer
  to this WAT, including the function declaration as line 1.

The investigation reused `wasm-tools 1.262.0` output and the existing byte-range index. It did not
repeat the documented REA provider, input-size, or WABT failures. No new REA evidence record exists.
No browser, private budget, production mutation, or server callable was used.

**Recovered** means instructions establish the stated client behavior. **Inference** identifies a
consequence of those instructions. **Unresolved** identifies missing code or runtime evidence. The
formulas below specify prospective CLI code, not arithmetic for agents to perform.

## Direct Save And Completion

Let `B` be the budget, `P` the selected existing period, `C` the category, and `N` the absolute new
allocation. Let `H` be a generated history ID and `M` a separately generated batch marker ID. For an
ordinary non-income category, `50286 → 50287 → 50304` constructs this batch:

| Document                  | Written Fields                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `budgets/B/periods/P`     | `balances.C.allocatedAmount=N`; `balances.C.updatedAt=Timestamp.now()`; `balances.C.lastUpdateChangeSource=USER` |
| `budgets/B/stashes/C`     | `data.historicalAllocations.<YYYY-MM>=N`                                                                         |
| `budgets/B`               | `allocationHistory.H=<history DTO>`; `changeSource=USER`                                                         |
| `budgets/B/saveMarkers/M` | `createdAt=serverTimestamp()`; `expireAt=client instant + 30 days`                                               |

The metadata document is the category-specific stash. Period path ID, model period ID, and model
month must agree. The direct writer sets amounts; it does not use increment transforms. Ordinary
allocation does not decrement period `allocationAmount`.

History fields are `id=H`, `categoryId=C`, empty `linkedCategoryId` and `accountId`, `periodId=P`,
`beforeAmount=A`, `afterAmount=N`, the supplied source, client `createdAt`, and null `undoneAt`.
Manual source is MANUAL; direct auto-allocation uses AUTO_ALLOCATION. Function 50296 constructs the
DTO and 50297 adds it to the budget update. History and marker IDs are not linked by a stored field.

For completeness, history overallocation uses the pre-change pool `R`:

```text
R2 = R - (N - A)
O = max(-R2, 0)
status = CAUSED     if O > 0 and R >= 0
         INCREASED  else if R < 0 and R2 + 1 <= R
         FIXED      else if R < 0 and R2 > R and O == 0
         DECREASED  else if R < 0 and R2 > R
         NONE       otherwise
stored overallocationAmount = 0 if status == NONE else O
```

Null pool, income category, and empty-category sentinel bypass this assessment. The native operands
are signed `i64`; a CLI safe-integer rejection policy differs from native overflow wrapping.
[Allocation Rules](allocation-contract.md) defines the ordinary pool and aggregation exclusions.

### Scheduling Boundary

Recovered call path:

```text
50304: queue writes → 44071 → 44070
44070: build marker information and tracking entry
       → 44140 → 3380/3379: start asynchronous coordinator
       → discard returned handle
44146 → 44151: coordinator executes commit callback
44089 → 44092 → 22101 → 22230 → JavaScript batch.commit()
```

Function 50304 returns Unit immediately after 44071. Function 44070 drops the coordinator handle at
lines 48–49. Neither joins it. The suspension wrapper in 50287 does not turn this into an awaited
remote commit. A successful repository return therefore does not prove server acceptance.

The non-batch budget update also starts asynchronous work: `50297 → 51363 → 44097 → 3378`. This
applies to history deletion and undo marking. The inspected paths contain no subsequent carryover
job or explicit period-resync request. This is a statement about these paths, not proof that other
subscribers or servers have no effects.

## Undo And History Deletion

Recovered undo entry is `50295 → 50281`. History display model `7726` has category `.5`,
`beforeAmount=.8`, `afterAmount=.9`, `changeAmount=.10`, period `.12`, source `.14`, creation time
`.15`, and `undoneAt=.16` (44293–44294). Function 50331 derives
`changeAmount=afterAmount-beforeAmount`; absent amount values become zero. Stored history DTO `7084`
instead uses `.9/.10` for before/after and `.15` for `undoneAt`.

Undo performs these steps:

1. Compare the supplied budget's selected period ID with the history period ID.
2. If they differ, obtain the budget model for the history period through `50285 → 4036`.
3. Search its categories for the history category ID. Use that category's current allocation, or
   zero when no matching category exists.
4. Call the direct writer for the **history period**, with source SYSTEM and this amount:

```text
delta = history.afterAmount - history.beforeAmount
undoAmount = currentAllocationInHistoryPeriod - delta
```

5. After the direct writer returns successfully, schedule a separate budget update:
   `allocationHistory.<originalHistoryId>.undoneAt=Timestamp.now()` and `changeSource=USER`.

Step 4 uses the original history's category object when the supplied budget already selects the
history period. Otherwise it prefers the fetched category, with the original category as fallback.
The amount still comes from the category search. These fallbacks are recovered behavior, not safe
CLI defaults for missing or stale categories.

The direct writer also records a new SYSTEM history entry with a new ID. It writes the category
stash's historical allocation again. Undo does not delete the original history entry. For example,
history `20 → 100` has change `+80`. If the category now holds `150`, undo sets `70`, not `20`.
Repeating the same calculation from `70` sets `-10`.

**Already-undone behavior:** 50281 and 50295 do not read `undoneAt`, reject SYSTEM, or acquire a
history precondition. The detail screen passes `undoneAt == null` into its action UI (67186). Its
`isUndoEnabled` model flag comes from a current-month check (67213 → 45442 → 17483). The list action
also checks current month before invoking undo (67168). These UI checks do not make the repository
operation idempotent. A stale or repeated invocation can subtract the change again. The repository's
cross-period branch does not establish an unrestricted public UI workflow.

**Partial completion:** the inverse batch and original-history mark are separate asynchronous
operations. The inspected code does not establish their server completion order or atomicity.
Possible states include an inverse without an undo mark, or an undo mark without a successful
inverse. Runtime evidence is required to characterize actual failures and recovery.

**Deletion:** 50292 only schedules a field deletion at `allocationHistory.<suppliedId>` and sets
budget `changeSource=USER`, through 50297. It does not call the direct writer, restore balances, or
change category historical allocations. Deletion is not undo.

## Commit Recovery And Resend

### Error And Marker Checks

The commit bridge converts native JavaScript errors through `22189 → 22190`. It reads `code`, falls
back to the throwable message, normalizes through 2944, and maps recognized Firestore codes. That
conversion does not itself request a retry.

The recovery predicate 44104 examines up to eight throwable-chain entries. It accepts the typed
PERMISSION_DENIED code or messages containing `PERMISSION_DENIED` or `permission-denied`. It is not
a general deadline-exceeded/unavailable retry predicate.

`44074 → 44064` reads a marker with source SERVER (`22142`, enum initializer 22132), then asks
whether the document exists. It does not inspect its contents, expiry, history ID, or payload. Both
44150 and fallback `44139 → 44148 → 44147` accept the first existing marker in the recorded marker
list. For the single-budget direct batch, that list contains one marker.

Recovered coordinator behavior is:

```text
attempt SDK commit
if commit succeeds:
    mark local tracking entry LANDED
else:
    if tracked entry permits resend
       and error is permission-denied
       and servicesMayHoldPlaceholder():
        run serialized App Check recovery/replay path
    otherwise, or when that path does not resolve the error:
        if permission-denied and marker information exists:
            read markers from SERVER
            treat any existing marker as landed
        otherwise retain the failure
```

Marker absence, a marker-read error, and a non-permission error do not establish a safe resend. No
operation-content comparison appears. Marker expiry is a written timestamp; actual TTL cleanup and
duplicate-write enforcement belong to uninspected server configuration.

### Why Direct Allocation Does Not Enter Automatic Resend

Function 44073 records operation document paths and removes save-marker paths from its overlap set.
For an SDK batch, it requires at most 500 recorded writes and eligible paths. `44152/44154` require
four nonempty path components: `budgets/B/{transactions|periods|stashes}/D`.

The direct allocation batch includes `budgets/B`, through `50304 → 50296 → 50297 → 51363 → 44068`.
Function 44068 records that root update in the replay list (lines 805–821). The root has two path
components, so 44152 rejects it. Therefore 44073 sets this batch's replay eligibility to false. If
tracking is unavailable, replay is also unavailable. Marker fallback remains possible.

This closes a previously open interpretation: the presence of `sendAgain` in the shared batch class
does not establish that direct allocation uses it.

### Shared Replay Path

Other eligible batches can use this recovered state machine (44121–44126):

1. Record the current sequence boundary and mark WAITING, then acquire the recovery mutex. Process
   WAITING entries in queue order. Wait up to 10 seconds for SENT entries at or before the captured
   boundary to settle (44122, 44136–44137; timeout configured in 83386). A failed wait returns
   SUPERSEDED.
2. Obtain App Check recovery through 44124. Its configured retry delays are 1, 2, 4, 8, and 16
   seconds (44120, wired in 83386). A nonretrying pass stops after the first failure.
3. Stop if the entry is already superseded, or a later overlapping entry makes replay unsafe.
4. Read server markers. An existing marker returns ALREADY_LANDED without replay. A read failure
   returns UNKNOWN.
5. Check supersession again. Rebuild a fresh SDK batch from recorded operations and commit once
   (`44091 → 44093`). More than 500 recorded operations throws before replay.
6. A successful replay returns LANDED. A permission-denied replay error performs another marker
   check; an existing marker also resolves as LANDED. Otherwise the result is REFUSED.

The other named outcomes are NO_TOKEN and SUPERSEDED (44112). After NO_TOKEN, 44122 enables the
delayed token-recovery mode for subsequent queued entries. These are local coordinator states, not
server receipts. Replay reuses recorded operation data and marker identity; it does not rerun
allocation arithmetic against a fresh budget snapshot.

The supersession predicate has a precise sequence rule. For waiting entry `E`, another entry `L`
blocks replay when (44125):

```text
L.sequence > E.sequence
and intersect(L.documentPaths, E.documentPaths) is nonempty
and (L.sequence > E.capturedSequence or L.state != WAITING)
```

The intersection uses exact document paths, not individual fields (44118). The sequence and path set
live in the client tracker, not a Firestore version check. When an entry becomes LOST, 44126 marks
later overlapping entries through its captured boundary as superseded. A second client can change
the same documents without entering this tracker. This mechanism does not establish cross-client
safety.

## Later-Period Materialization And Carryover

Recovered stored inputs are period `allocationCarriedOverAmount` (`7048.10`), category balance
`carriedOverAmount` (`7002.6`), and category stash `data.historicalCarriedOver` (48568). They are
distinct from `historicalAllocations`. Function 50331 consumes stored period carryover when it
rebuilds the pool. Balance/target model reconstruction consumes stored category carryover. Those
reads do not establish persistence of recalculated later periods.

There is positive evidence of server requests for period materialization:

| Client Function | Callable                                   | Request Fields                                      |
| --------------- | ------------------------------------------ | --------------------------------------------------- |
| 50726           | `periods-createAndSelectPeriod`            | `budgetId`, `yearMonth`                             |
| 50727           | `periods-createMissingPeriodsUpToEarliest` | `budgetId`, `startYearMonth`, `selectAfterCreating` |
| 50728           | `periods-createMissingPeriods`             | `budgetId`, `startYearMonth`, `endYearMonth`        |
| 50415           | `integrity-resyncAvailableToAllocate`      | `budgetId`, `periodId`                              |
| 50417           | `integrity-resyncCategoryBalances`         | `budgetId`, `periodId`                              |

The wrappers construct the callable name and payload and reach the cloud-function transport. They do
not contain the server's period-generation or repair algorithm. Function 50726 can route an
earlier-period request through 50734/50727; 52087 invokes the range-creation path 50728. No
invocation of these callables was recovered after direct save or its historical-allocation update.
The integrity wrappers are separate entry points, not a proven allocation-completion step.

The search also covered imported carryover strings and explicit DTO construction/mutation sites
throughout the decoded module. `struct.set 7002 6` occurs only in 48810 and 48812. The former
constructs a zero default; the latter decodes stored balances. `struct.set 7048 10` occurs only in
period decoder 48804. These bounded negative results do not exclude dynamically assembled field
paths, untraced indirect subscribers, or server triggers.

**Unresolved:** who updates existing later periods after an earlier allocation changes, the exact
carryover formulas, the category-history producer, propagation order, and a completion signal. No
server function body, security rule, trigger configuration, or authorized before/after fixture was
available. It is incorrect to assign propagation to the server solely because 50304 lacks it.

An existing latest-period save has no known later document to update. That narrows exposure but does
not prove full native equivalence. Once a later period exists, the CLI must also establish its
carryover effects. Creating that later period invokes a server boundary whose arithmetic remains
unrecovered. Concurrent period creation is also outside the recovered direct-write guarantees.

## Operation Identity And Prospective CLI Scope

No recovered native field binds an explicit CLI operation ID to exact content. Reusing `M` only
selects a marker path. Reusing `H` only selects a history entry; native history has no immutable
payload digest or marker reference. Adding fields, overloading a source value, or making `H=M` does
not establish acceptance by deployed rules.

A local durable manifest can bind a CLI operation ID to `M`, `H`, exact writes, source versions, and
amounts without adding remote fields. That is a CLI design, not a recovered native protocol. It must
survive retries and reject changed content. It cannot alone provide cross-device identity, recover a
lost manifest, or prove an operation absent after marker/history cleanup.

The current `BeyondClient.commit` has two relevant limitations:

- Its path guard requires a descendant of the budget path, so it rejects the native history write to
  the budget root itself.
- Its marker fallback accepts existence without comparing content. It swallows marker-read errors
  into absence and uses a 29-day marker lifetime. This is not the recovered native coordinator.

The smallest safe next implementation is a **manual absolute-allocation write preview**. It needs no
target schedule or category priority calculation. CLI code can build the batch and history from
validated snapshots, report exact source versions and unsupported cases, and keep execution
disabled. No production code changed during this investigation.

A prospective first live scope, after independent validation, is one ordinary flat non-income
category in an existing current month that is also the latest materialized period. It requires
existing category metadata, consistent identities, supported zero-based pool inputs, and checked
amounts. Exclude links, hierarchy, special/archived categories, historical periods, period creation,
undo, and bulk execution. Reject an insufficient pool as an explicit CLI policy if desired.

The writer must await remote completion, protect its read set against concurrent changes, support
the budget-root update narrowly, and bind retry identity durably. These are CLI requirements, not
claims about native checks. Unknown commit outcomes must remain unknown until independent evidence
resolves them; they must not trigger a newly calculated replacement operation.

## Offline Verification And Required Runtime Evidence

An isolated WASM module retained these original instruction fragments:

- 50331, lines 1836–1856: nullable stored after amount minus nullable stored before amount.
- 50281, lines 175–179: current allocation minus history change.
- 44125, lines 32–61: one candidate's supersession predicate.

The harness remapped local/type indices, supplied minimal GC structures and WAITING references, and
supplied the path-intersection result. It did not replace the tested arithmetic or branches.
`wasm-tools 1.262.0` compiled the module; Node.js 24.22.1 executed it.

All 1,372 undo comparisons and 1,372 supersession comparisons passed against separate formulas. Each
used the seven values `[-2^63, -(2^53+1), -1, 0, 1, 2^53+1, 2^63-1]` and both boolean states. Ten
independent literal cases also passed, including intervening allocations, repeated undo, negative
changes, absent history amounts, overflow, and overlapping sequence boundaries. The initial harness
failed compilation because one local index was not remapped; the corrected harness passed. This was
an extraction error, not an app failure.

These results establish only the extracted fragments under synthetic inputs. They do not test the
full collection traversal, coroutine scheduling, UI guards, App Check, serialization, or Firestore.
The arithmetic comparison uses signed-64-bit wrapping. The production CLI can instead reject unsafe
integers and overflow explicitly.

Independent tests still require an authorized disposable budget:

1. Save one ordinary allocation in the latest existing month. Compare all four direct documents,
   account/transaction stability, and documents after synchronization with the app closed.
2. Create a later period, then change the earlier allocation. Measure category carryover, allocation
   carryover, category history, every affected period, and the time at which results stabilize.
3. Repeat with negative balances and category carryover NONE. Establish formulas and completion from
   evidence rather than assumed month-to-month conservation.
4. Undo after an intervening allocation. Test already-undone and stale history, and interrupt each
   independent write. Compare SYSTEM history and original `undoneAt` separately.
5. Lose the commit response; deny a marker read; reuse an operation ID with identical and changed
   payloads. Test marker expiry and a second client writing the same category.
6. Validate native marker/history field constraints and creation permissions. Check concurrent
   period creation and source-version conflicts before enabling the bounded writer.
