# Recurring Transaction Deletion

This report records native deletion behavior and the boundary for CLI recurring-deletion scopes. It
supports deleting obsolete occurrences without changing earlier financial history. No live budget
was changed during this investigation.

## Use The Scopes

Preview one stored occurrence while preserving its generated successors:

```sh
bebu transactions delete <id> --scope THIS_PAYMENT --dry-run
```

Preview removal of the selected occurrence and its verified later chain:

```sh
bebu transactions delete <id> --scope THIS_AND_LATER --dry-run --full
```

Recurring deletion requires an explicit scope. The default one-off deletion remains available.
Review `deletedTransactions`, `preservedTransactions`, and the combined ledger effects before a
write. The generated [delete reference](../../skills/bebu/commands/transactions/delete.md) lists the
complete restrictions.

`THIS_PAYMENT` requires a generated successor or an exhausted finite repeat limit. An ongoing tail
without a successor stops with an error instead of silently ending its series. The CLI does not
synthesize a replacement occurrence.

## Evidence Identity

The investigation reused the saved public web module and indexed WAT from
`.research/beyond-2026-10-22/wasm-analysis/`. Both artifact hashes matched during this
investigation:

- Module: `4ef2928daa118d1b3431.wasm`, 33,069,046 bytes.
- Module SHA-256: `1c9b9bb1e7699c7080cba0095485e04772285c200ab458f57346161d233a9eea`.
- Decoded WAT SHA-256: `dfa66d5044ec6cc1a31f53c6437d325d34d2190fc475f2894c899c474f7c6c9c`.

Function numbers and line numbers below refer to that WAT. The evidence is static client
instructions, not observed backend execution. REA reported its WASM provider unavailable because
`REA_WABT_BIN_DIRECTORY` was unset. The saved decoded artifact supplied the evidence. No new REA
evidence IDs were produced, and no provider configuration changed.

## Native Single-Occurrence Deletion

The detail and summary screens use the same transaction deletion service. Their confirmation paths
are `78283` and `80354`. Both call `52060 → 52066`, which calls the repository through
`50918 → 50909 → 50956 → 50967`.

For outflows, typed delete `51749` reaches shared deletion through `83859 → 51697 → 51688`. The
shared path loads the selected canonical transaction and its ledger dependencies. It submits
callback `51723` through batch writer `51376`.

Callback `51723` deletes the selected canonical record through `51367`. It then invokes the same
ledger handler as creation, with the removal parameter enabled. Function `51367` also records a
`DELETE` operation in the batch metadata. It does not edit a predecessor or a successor.

The inspected deletion path does not query transactions by `eventId`. It does not traverse
`clonedToTransactionId`, create another occurrence, change frequency, or clear recurrence fields.
The native `THIS_PAYMENT` and `THIS_AND_LATER` enum describes editing overrides. Its presence does
not establish native deletion scopes.

## Financial Reversal

Removal uses the common signed effects established in
[Card Purchases And Refunds](card-transactions.md). Function `51728` negates the creation increment.
Functions `51729`, `51731`, `51752`, and `51758` apply account, history, category, and reserve
effects.

Completed expense deletion reverses account money, category spending, and applicable payment
reserves. History reversal retains the original transaction date. Preview membership and usage
counts follow the shared account, category, period, payee, and tag handlers.

Account, category, payee, and tag `transactionCount` decreases for completed and upcoming deletion.
Non-period `completedTransactionCount` decreases for completed deletion, even when the preview was
trimmed. Period indexes do not receive that counter change. No decrement clamp appears in the
inspected path. These rules come from `51729`, `51735`, `51757`, and
`51714 → 51713 → 51730 → 51706`.

Upcoming expense deletion reverses its `upcomingAmount`. It does not reverse completed account
money, spending, or payment reserves. Periodless upcoming entries do not acquire a period through
deletion.

Deletion does not establish that allocation capability flags caused an allocation. The service
separately examines allocation eligibility through `52088 → 51846`. Existing allocation history and
active allocation predicates still require their native reversal paths.

## Clone Links And Completion

The domain transaction stores `clonedToTransactionId` at field 34 of struct `8159`. The canonical
DTO stores it at field 35 of struct `6979`. Functions `45768`, `48947`, and `48952` establish these
field identities. Function `49253` also copies the link into transaction previews.

Function `45777` computes effective completion. After its special-type and future-date checks, a
past recurring transaction with a nonempty clone link returns completed. It does not load the linked
transaction. Without a clone link, its recurring completion case requires `repeatCount` to equal
`sequenceCount`. Function `51690` uses this predicate to construct the canonical completion field.
Allocation eligibility also uses this predicate through `51846`.

A retained predecessor can therefore remain completed after its child is deleted. Clearing its clone
link changes the predicate and can change financial or allocation behavior. Retaining the original
link matches the inspected native single-occurrence deletion path. Calling the link a backend
consumption marker remains an inference because the generator is not present in this evidence.

## CLI Scope Boundary

CLI scopes select records before applying native single-occurrence reversal. Scope selection is a
CLI policy, separate from the recovered native deletion primitive.

- `THIS_PAYMENT` selects the supplied occurrence and preserves other stored occurrences.
- `THIS_AND_LATER` selects the supplied occurrence and its validated forward clone chain.
- Earlier occurrences retain their canonical data, financial history, and clone links.
- Matching `eventId` values do not establish membership in one chain.

A forward link supplies a candidate successor identity. The CLI also validates budget and
transaction identity, consecutive sequence numbers, increasing dates, frequency, timezone, type,
subtype, targets, payee, and notes. A cycle, branch, inconsistent successor, or ambiguous boundary
stops planning before any write.

Same-event records outside the verified chain remain untouched. Sequence numbers and event IDs can
help reject an inconsistent link, but cannot authorize deletion without a link.

Deleting the only stored future tail cannot preserve future payments by itself. The inspected native
delete path does not generate a replacement. Supporting that case requires established generation
semantics, or an explicit refusal for an ongoing series. A naturally exhausted repeat has no future
payment to preserve.

## Reminder And File Boundary

After the native transaction deletion, `52066` calls `52101` with deletion enabled. An existing
reminder reaches `50757 → 50758`. That path deletes the reminder stash member and canonical
`budgets/<budgetId>/reminders/<reminderId>` document through `51368` and `51366`.

These reminder writes form a separate native batch. They are not part of callback `51723`.
Attachments also have a separate deletion path through `52108 → 52082`. CLI deletion must either
include supported reminder effects or reject a stored reminder it cannot safely delete. Scoped CLI
deletion removes matching reminder documents and `REMINDERS` stash members in the same atomic
commit. It checks the reminder index regardless of the stored `reminderEnabled` flag. An enabled
reminder without an available reminder index rejects the plan. File-backed transactions remain
outside the supported transaction writer.

## Evidence Locations

| Function         |   WAT Start Line | Observed Contract                                                       |
| ---------------- | ---------------: | ----------------------------------------------------------------------- |
| `45768`          |          3953537 | Domain transaction field descriptors                                    |
| `45777`          |          3954689 | Effective completion uses clone-link presence without successor lookup  |
| `47359`          |          4087686 | Edit override scope values                                              |
| `48947`, `48952` | 4238851, 4245763 | Canonical field serialization and diagnostic names                      |
| `49253`          |          4331967 | Canonical transaction preview projection                                |
| `50758`          |          4499586 | Reminder stash and canonical deletion                                   |
| `50909`, `50967` | 4515004, 4520296 | Repository deletion dispatch                                            |
| `51367`          |          4550757 | Canonical deletion and batch DELETE metadata                            |
| `51688`          |          4574294 | Shared selected-record deletion coordinator                             |
| `51690`          |          4575104 | Canonical completion from the domain predicate                          |
| `51723`          |          4579031 | Canonical delete and ledger removal in one callback                     |
| `51728`          |          4579364 | Removal increment negation                                              |
| `51752`, `51758` | 4580779, 4581330 | Outflow account, category, reserve, and upcoming effects                |
| `51846`          |          4588221 | Allocation predicate uses effective completion                          |
| `52066`          |          4621200 | Transaction delete followed by reminders, files, and allocation cleanup |
| `52101`          |          4630241 | Delete mode removes the existing reminder                               |
| `78283`, `80354` | 7369645, 7562766 | Detail and summary deletion confirmations                               |

## Atomic Planning

All scoped reads, incoming-link queries, and ledger dependencies use one Firestore transaction
snapshot. Dry runs use a read-only transaction and roll it back without committing. Execution
commits all selected deletions, reversals, reminder cleanup, indexes, counters, and one save marker
together. Earlier records are read for boundary validation and remain unwritten. Concurrent changes
to those dependencies or incoming-link queries abort the transaction without automatic retry. The
[Firestore query API](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/runQuery)
supports running a query in an existing transaction.

Inspection stops at 100 occurrences. Plans exceeding 499 writes before the marker, or 8 MB of write
JSON, are rejected. The command never divides one requested deletion chain into separate commits.
Existing request-marker limitations remain: marker existence does not bind a request ID to its
payload. After successful deletion, an identical retry can fail during validation before marker
lookup.

## Remaining Unknowns

The module does not establish backend recurrence generation, server triggers, or regeneration after
a linked successor disappears. No server implementation or live mutation supplied that evidence. The
inspected direct deletion path establishes no terminal marker beyond preserved stored links.

Date projection `53029` and its direct callers establish forecast and editing dates, but no
canonical successor creation. The CLI does not claim complete native parity or synthesize a
successor from date formulas alone. Those formulas establish dates, not the complete occurrence
write contract. Chain selection and concurrency tests establish CLI behavior under controlled
documents, not server-trigger behavior.
