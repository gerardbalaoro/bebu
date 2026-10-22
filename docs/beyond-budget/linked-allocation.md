# Linked Income Allocation Lifecycle

This report supports a bounded CLI implementation of linked savings-account income. It recovers
client operations from the public web build on 2026-10-23. It does not establish server effects or
complete native equivalence. No browser, private budget, or financial write was used.

The operation signs and ordinary create, clearing-change, and delete call paths are resolved. The
important asymmetry is history: unclearing reverses the allocation increment but does not delete
linked history on the inspected path. The CLI's financial-write guards must remain.

## Evidence Identity

- Module: `4ef2928daa118d1b3431.wasm`, 33,069,046 bytes.
- Module SHA-256: `1c9b9bb1e7699c7080cba0095485e04772285c200ab458f57346161d233a9eea`.
- Decoded WAT SHA-256: `dfa66d5044ec6cc1a31f53c6437d325d34d2190fc475f2894c899c474f7c6c9c`.
- Decoder and slice compiler: `wasm-tools 1.262.0`. Synthetic execution: Node.js `24.22.1`.

Both hashes matched during this investigation. Function and struct numbers below refer to this
module. They are sufficient anchors for independent extraction from its WAT. The existing indexed
decode was reused. Prior REA provider, input-size, and WABT GC failures were not repeated. This pass
produced no new REA evidence IDs.

## Bounded Inputs And Field Mapping

The lifecycle below uses one positive, completed, ONE_OFF INFLOW into a GENERIC_ACCOUNT. The account
has one category link. The transaction has no source target, extra target, payee, tags, files,
import key, split, or recurrence. Its category and account are present in the current models. The
account uses the budget currency. The category is flat, nonarchived, DEFAULT, and COMPUTE in a
DEFAULT group. These restrictions avoid unrelated model and currency behavior. The budget has no
active challenge. The selected context period agrees with the transaction period. Preview admission
accepts the transaction without eviction. These restrictions define the investigated case, not
native validation rules.

The linked predicate itself has no target-demand, category carryover, partial-allocation, overwrite,
ignore-pool, or budget-type test. ZERO_BASED controls the separate allocation-resource increment. No
balance, positive-amount, or available-pool limit occurs in the linked increment helper.

| Meaning                                    | Canonical DTO           | Calculated Transaction   |
| ------------------------------------------ | ----------------------- | ------------------------ |
| ID                                         | `6979.4`                | `8159.4`                 |
| Source / destination target                | `6979.5 / .6`           | `8159.5 / .6`            |
| Extra target                               | `6979.8`                | `8159.8`                 |
| Amount / completed                         | `6979.10 / .11`         | `8159.10 / .11`          |
| Due date / budget / period                 | `6979.14 / .15 / .16`   | `8159.14 / .15 / .16`    |
| Event ID                                   | `6979.23`               | `8159.22`                |
| Cleared                                    | `6979.36`               | `8159.28`                |
| Version                                    | `6979.45`               | `8159.48`                |
| Capability flag                            | `6979.46`               | `8159.49`                |
| Income-allocation flag                     | `6979.47`               | `8159.50`                |
| Target ID / linked ID / linked type / type | `7088.4 / .5 / .6 / .7` | `7760.4 / .6 / .7 / .10` |

Formatters 48952 and 45779 establish the transaction names. Function 49216 constructs an account
target from the account model and its linked category. Stored account/category link fields alone are
insufficient: the allocation operation consumes the transaction's target snapshot.

Functions 51847–51849 reduce to:

```text
eligible(t, target):
    if t.targetFrom?.linkedId == t.targetTo?.linkedId: return false
    return t.completed and t.cleared and t.autoAllocateIfCapable
       and t.version != null
       and target.linkedId != null and not blank(target.linkedId)
       and target.type == GENERIC_ACCOUNT
       and target.linkedType == CATEGORY
```

The version check tests presence, not a numerical threshold. It is not a concurrency precondition.
`autoAllocateIfIncome` and `extras.autoAllocated` do not enter this predicate. Empty `extras`
therefore does not exclude linked allocation.

## Event Entry Points And Ordering

The following paths include UI events and the actual persistence dispatch. Arrows across closures
include recovered `ref.func` and interface-table bindings, not only direct calls.

| Event            | Recovered Path                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Create           | `TransactionSaver.create` continuation 78281 → 52098 → 52072 → 52139 → 52156 → 50916 → 50907 → 50954 → 50965                                 |
| Toggle cleared   | `TransactionSummaryViewModel.onClearedToggled` 80340 → 80195 → 80173 → 80196 → 80174 → 52059 → 52092 → 52065 → 50917 → 50908 → 50955 → 50966 |
| Delete confirmed | `TransactionSummaryViewModel.onDeleteConfirmed` 80354 → 52060 → 52066 → 50918 → 50909 → 50956 → 50967                                        |

Function 80340 copies the transaction with `cleared = !old.cleared`. The bulk-change path also has
an explicit cleared-setting branch: 52151 recognizes struct 7276, copies its boolean, then
calls 52092. Its metadata-only skip condition does not include this cleared-setting type.

Repository dispatcher 50919 selects `InflowTransactionHandler`, struct 6433, for INFLOW. Interface
table 142069 binds create/delete/update to 51739/51740/51741. Those enter 51695/51697/51698, then
51687/51688/51689. The handler closure comes from 51743 → 51738 → 51744.

The batch callbacks establish the direction:

```text
create: 51722 -> queue canonical set -> apply(new, remove=false)
delete: 51723 -> queue canonical delete -> apply(stored, remove=true)
update: 51724 -> apply(stored, remove=true)
                apply(replacement, remove=false)
                queue replacement canonical set
```

Update continuation 51689 reads the canonical old DTO through 51701, then normalizes the replacement
through 51700/51690. It passes both to the same batch callback. This proves the old-then-new order.
The inverse signs are not an assumption based on helper names.

Function 51744 selects global 96468 for removal and 96469 for addition. Initializer 83723 binds them
to 51728 and 14314:

```text
operationAmount(x, remove) = wrapI64(-x) if remove else x
operationCount(remove) = -1 if remove else +1
```

The inflow handler sends `transaction.amount` to 51844. It does not apply `abs` to the linked period
increment. Transfer helper 51836 has different pre-mapper signs and is outside this lifecycle.

## Client Write Set

Let `B` be the budget, `T` the transaction, `A` the account, `C` the linked category, and `P` the
transaction period. `S_accounts` and `S_transactions` come from the budget's stash identifiers. `m`
is the signed transaction amount. `q = operationAmount(m, remove)`.

Each `apply` below uses the batch supplied by 51722, 51723, or 51724. Helper 51376/51333 creates or
reuses that batch. The ordinary branch requests commit through 44071. Its retry branch can rebuild
the callback. This report does not establish remote acknowledgment or retry completion semantics.

| Document                           | Client Operations For One Apply                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `budgets/B/periods/P`              | If completed and cleared in ZERO_BASED, increment `allocationAmount` by `q`. If destination qualifies, increment `balances.C.allocatedAmount` by `q`, set `balances.C.updatedAt = Timestamp.now()`, and set `balances.C.lastUpdateChangeSource = USER`. |
| `budgets/B/stashes/S_accounts`     | Increment `data.A.transactionCount` by the operation count. Set `data.A.updatedAt = Timestamp.now()`. For completed income, increment **one** field by `q`: `data.A.balanceAmount` when cleared, otherwise `data.A.unclearedBalanceAmount`.             |
| `budgets/B/stashes/A`              | For completed, cleared income, increment `data.historicalBalances.K` by `q`. Also apply the account preview operations below.                                                                                                                           |
| `budgets/B/stashes/P`              | Apply the period preview operations below. This is a stash document, separate from `periods/P`.                                                                                                                                                         |
| `budgets/B/stashes/S_transactions` | Apply the global transaction preview operations below.                                                                                                                                                                                                  |
| `budgets/B/transactions/T`         | Create or update with the normalized DTO using merge semantics. Create also queues `integrityCount += 1`. Update queues `integrityCount += -1`, then `+= 1`. Delete removes the document.                                                               |
| `budgets/B/saveMarkers/M`          | Batch infrastructure attaches the budget marker: server `createdAt`, client-derived `expireAt` 30 days later. `M` is distinct from `T`.                                                                                                                 |

Anchors: 51744 dispatches the paths. 51745 writes period amounts. 51712/51729 write account totals.
51715/51731/51717 write account history. 51713/51730 write previews. 51364/51367 write the canonical
document. The merge option resolves through 44067 → 22098 → 22231 to `merge=true`.

The account callback supplied by 51744 is global 97387 → 6898, which returns Unit without writes. It
does not add a second balance increment. Thus raw `balanceAmount` and `unclearedBalanceAmount` are
distinct destinations in this handler.

`K` is the year-month derived from `dueAt` through 53509 → 53346/53371 → 17482. The zone provider
53346 → 53348 → 17439 → 17368 reaches the JavaScript `systemDefault` import 677. This helper does
not read the DTO's `yearMonth` or `timezone` field. A CLI must not silently substitute either field
without establishing agreement, especially near a month boundary.

There is **no direct linked-category historical-allocation write** in this bounded inflow dispatch.
With no extra target, 51742 returns null and 51744 skips 51732. The category index and category
stash `stashes/C` receive no operation from this branch. This is a client-write observation, not
proof that a server cannot update those documents.

The separate income-allocation path requires a nonnull extra-target ID, completed, cleared, and
`autoAllocateIfIncome=true` (51742). It can invoke 51732 with `operationAmount(abs(m), remove)` for
`data.historicalAllocations.K`. It is not the producer of ordinary linked-category metadata.

### Preview And Index Effects

For these completed transactions, the preview field is `data.completedTransactions.T`. Addition sets
the projection from 49253, then queues its `integrityCount += 1`. Removal deletes that map entry.
The account and global stashes adjust `data.completedTransactionCount`. The period stash does not
adjust this count: 51744 passes `count=false`, whereas 51714 passes `count=true`.

An update removes the old preview, then inserts the replacement. With admission and no eviction,
account/global counts have net change zero. Create changes them by +1. Delete changes them by -1.
These are the constructed operations, not a claim about missing or inconsistent existing previews.

The projection copies amount, completed, cleared, type, subtype, frequency, due date,
reconciliation, notes, color, sentiment, recurrence fields, external ID, tags, coordinates, and
split identity. Targets become `targetFromId`, `targetToId`, `extraTargetId`, and `payeeId`. File
presence becomes `hasFiles`. The creator becomes `createdByUserId`. Struct 6975 and formatter 48967
identify these fields. Nullable offset adjustment becomes zero, and anchor day survives only in the
range 1–31.

The decisive allocation projection is:

```text
preview.hasAutoAllocated = eligible(transaction, transaction.targetTo)
preview.autoAllocateIfIncome = transaction.autoAllocateIfIncome
```

Function 49253 calls 51848 for `hasAutoAllocated` (`6975.33`). It is a derived eligibility flag, not
evidence that a prior remote write completed. Clearing sets it true for the bounded linked case.
Unclearing makes it false. Canonical `extras` can remain empty throughout.

Preview admission is stateful. Functions 51713/51772 inspect stash types TRANSACTIONS, ACCOUNT,
CATEGORY, PAYEE, and TAG. The completed-preview branch tests count >450 or estimated bytes >700,000.
Eviction can delete other preview IDs, set `data.trimmed=true`, and change the completed count by
`inserted - evicted` (51730). The byte estimator includes 49404. General eviction order, missing
preview behavior, and serializer byte equivalence are not closed here. The lifecycle table assumes
admission without eviction. It must not be applied to arbitrary trimmed indexes.

Payee, tag, and collection branches exist in 51718–51721 but are inactive under the bounded inputs.
Import-key writes in 51696 are also inactive. Files, reminders, and challenge actions occur in
service steps outside the batch and are not generalized by this report.

## Before-And-After Transforms

This table uses positive `m`, unchanged eligibility inputs except `cleared`, and a ZERO_BASED
budget. It derives transforms from the recovered instructions, rather than measured backend
outcomes. Each delta adds to the stored value. Historical balances use the account stash and key `K`
above.

| Event              | Raw Account Balance | Uncleared Balance | Account Historical Balance | Allocation Resource | Linked Allocation | Separate Linked History                         |
| ------------------ | ------------------: | ----------------: | -------------------------: | ------------------: | ----------------: | ----------------------------------------------- |
| Create cleared     |                `+m` |                 0 |                       `+m` |                `+m` |              `+m` | Set entry `T`                                   |
| Create uncleared   |                   0 |              `+m` |                          0 |                   0 |                 0 | No operation                                    |
| Clear false → true |                `+m` |              `-m` |                       `+m` |                `+m` |              `+m` | Set or replace entry `T`                        |
| Clear true → false |                `-m` |              `+m` |                       `-m` |                `-m` |              `-m` | No operation, existing entry remains            |
| Delete cleared     |                `-m` |                 0 |                       `-m` |                `-m` |              `-m` | Delete entry `T` if the service model qualifies |
| Delete uncleared   |                   0 |              `-m` |                          0 |                   0 |                 0 | No operation, existing entry remains            |

Create/delete also change the account transaction count by +1/-1. Clearing changes produce -1 and +1
in the batch, for net zero. The account timestamp changes on every apply. The category timestamp and
USER source change whenever a qualifying linked increment is queued, including a reversal.

For an ordinary COMPUTE category in a non-INCOME group, the ZERO_BASED resource and allocation
deltas cancel in the pending-pool formula. For other budget types, the resource branch is absent
while the linked predicate remains possible. This table does not claim support for every such budget
model.

## Separate History, Identity, And Failure Boundaries

After repository creation, 52156 invokes 51921 and then 52110 → 52084. After repository update,
52065 runs file cleanup through 52108, then invokes 52110 unless its explicit skip flag is true. The
ordinary cleared-toggle route passes false. After repository deletion, 52066 performs reminder and
file work, then invokes 52088. These service steps are ordered calls, not one atomic commit.

Both history helpers require INFLOW or TRANSFER and the model predicate 51846. This predicate uses
the destination link and delegates to 51849. The create/update helper additionally looks up the
linked category and destination account in current models. If either lookup fails, it returns
without history even though the earlier transaction operation can already have run.

For the bounded linked income, 52084 → 50271 → 50296 constructs:

```text
allocationHistory[T] = {
    id: T, categoryId: "", linkedCategoryId: C, accountId: A,
    periodId: currentRepositoryContext.periodId,
    beforeAmount: 0, afterAmount: m,
    overallocationAmount: 0, overallocationStatus: NONE,
    source: LINKED_CATEGORY, createdAt: Timestamp.now(), undoneAt: null
}
budget.changeSource = USER
```

The history period comes from context `8502.13`, not directly from `transaction.periodId`. Amounts
describe the transaction contribution, not the category's before/after total. Re-clearing can
replace the same history key and creation timestamp. It does not append a new reversal event.

Function 50271 supplies no batch. Function 50297 → 51363 → 51377 creates a separate budget-update
batch. Deletion uses 50292 to delete exactly `allocationHistory.T`, also with `changeSource=USER`.
It does not search stored history IDs under other map keys and does not set `undoneAt`. These calls
return result wrappers. The inspected 52084/52088 continuations discard their contents without the
`2417` success check used after the repository call. Their return is not proof of durable, atomic
history persistence.

Unclearing fails the replacement's history predicate. No update-side call to 52088 or 50292 occurs
on this path. A later delete of the uncleared transaction also fails that predicate. Therefore the
recovered client sequence can leave a stale history entry. Server cleanup remains unknown.

Identity roles must stay separate:

- `T` identifies the canonical transaction, previews, and linked-history map entry.
- `eventId` is DTO field 6979.23. Normalizer 51690 preserves the stored event ID on update, rather
  than creating a new reversal identity. It does not select the linked-history key.
- `version` controls capability compatibility. Normalizer 51845 can set it to 1 for newly completed
  work or retain the prior value. It is not a monotonically incremented save revision.
- `M` identifies the batch save marker. It is separate from transaction and event identity.

No content fingerprint or duplicate-increment suppression is established by these identities.
Calling the addition handler again still constructs increments.
[Allocation Persistence](allocation-persistence.md) records the shared retry coordinator. Its
findings do not establish complete recovery for this lifecycle or server effects. An unclearing
operation is not a replay or history undo.

## Balance Adjustment Reuse

`AdjustBalanceViewModel.onConfirmClicked` continuation 57949 computes:

```text
delta = enteredBalance - accountModel.balanceAmount
if delta == 0: return
request = 45890(user, account, date, delta, BALANCE_ADJUSTMENT,
                autoReconcileEnabled, autoAllocateEnabled)
create(request)  // 52098 -> 52072 -> 52139 -> 52156
```

Formatter 57924 identifies the two booleans. Function 45890 builds an INFLOW with the account as
destination, subtype BALANCE_ADJUSTMENT, `editable=false`, and the chosen capability flag. It uses
the same creation repository and linked-history follow-up. The subtype prevents normal amount-sign
normalization in 52105, so a negative adjustment can reach the same signed inflow mapper.

This establishes reuse, not full adjustment parity. Positive adjustments with the bounded inputs use
the ordinary linked contribution. Negative adjustments, debt/off-budget accounts, selected dates
that change completion, and the optional reconciliation pass remain outside the verified lifecycle.
When auto-reconcile is enabled, 57949 performs additional work after creation, including 52078. The
CLI must not treat the whole adjustment as the single batch described above.

## Verification And Remaining Work

The offline experiment extracted the instructions of 51847, 51849, 51742, 51728, and 14314. It
remapped types and supplied synthetic GC objects, enum references, and string equality/blankness
helpers. The extracted predicates and arithmetic ran in a compiled WASM slice, independently of CLI
code.

All **10,290 comparisons passed**:

- 10,240 linked-predicate combinations: absent/present versions, equal/different/null/blank IDs,
  enum choices, completed, cleared, and capability flags.
- 32 extra-target predicate combinations, including the separate income-allocation flag.
- 18 mapper cases, covering both directions, zero, signs, values outside JavaScript's safe-integer
  range, and signed-i64 endpoints.

Negating `-9223372036854775808` returned that same value through signed-i64 wrapping. The increment
bridge 82789 then uses `f64.convert_i64_s` before Firestore import 771. Exact i64 arithmetic inside
WASM therefore does not establish exact remote integers outside the safe range. A CLI safe-integer
rejection policy must remain explicit.

An initial synthetic type declaration used unpacked booleans. Node rejected `struct.get_s` against
those fields. The harness corrected them to packed `i8` fields, preserving the extracted
instructions. The successful comparisons did not run event continuations, DTO encoding, preview
admission, Firestore, or backend code. They validate the extracted predicates and signs only.

The remaining implementation boundaries are precise:

1. **Backend effects:** no server artifact or authorized mutation fixture establishes
   linked-category historical allocations, carryover propagation, stale-history cleanup, or
   synchronization completion.
2. **Preview admission:** 51713/51730 identify admission, trimming, and count operations. General
   eviction order and wire-size equivalence still need recovery or a proven no-eviction restriction.
3. **Time and context:** account history uses system-zone `dueAt`. Linked history uses the current
   repository period. Cross-period edits and context changes cannot use a guessed common month.
4. **Independent validation:** no native before/after fixture verifies the full write set, separate
   history failure, stale versions, or ambiguous commits. Encoder omission/null behavior also needs
   wire validation. The slice cannot replace that evidence.
5. **Broader transactions:** links that change during an edit, deleted targets, transfers,
   recurrence, tags/payees, attachments, reconciliation, and negative adjustment workflows need
   their own contracts.

## Smallest Safe CLI Change

Keep `requireIndependentTransaction` in `allocation-effects.ts` for commits. Do not remove its
history check or replace capability checks with `autoAllocateIfIncome`. Stale history is possible,
but absence or presence alone still cannot establish the complete financial state.

The smallest useful extension is a pure CLI-owned linked-income effect preview. It can report the
eligibility reasons, the lifecycle deltas above, `hasAutoAllocated`, and the separate history
action. It must retain `executionSupported: false`, report admission/context limits, and bind
calculations to explicit snapshots. It must not route an incomplete write plan through the commit
path.

There is also a concrete prerequisite in the current transaction code. `accountEffects` in
`transactions.ts` increments raw `balanceAmount` and account history for uncleared income, then also
increments `unclearedBalanceAmount`. Native 51729 selects one balance field, and 51731 gates history
on completed plus cleared. The CLI's cleared-update branch changes uncleared balance and allocation
resources but omits the native cleared-balance and account-history movement. These are
static-derived discrepancies to validate and address before extending financial writes.
