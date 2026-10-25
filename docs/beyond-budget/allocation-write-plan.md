# Allocation Write Implementation Plan

The CLI can support manual allocation writes through an explicit optimistic Firestore transaction.
Disposable-budget probes now establish the native save shape, linked-category behavior, and a
bounded carryover case. The bounded writer is now implemented. See
[Manual Allocation Writer](allocation-writer.md) for current behavior. The plan below preserves the
original sequence and release considerations.

Implementation differences: permanent exclusive request claims replace removable process locks.
Recovery observes uncertain operations without taking over their claims. Additional fixtures permit
next-month allocations and upcoming bills, while rejecting next-month income, spending, and other
funds. Primary's read-only pool matches the native app; its financial state was not changed. The
expanded evidence file includes native FUND_OVERRUNS and deployed CLI saves.

This plan supersedes the untested release assumptions in
[Allocation Persistence](allocation-persistence.md). That document retains the older artifact
analysis, history assessment formula, and undo findings. The intended reader is the maintainer
implementing and reviewing allocation commands.

## Investigation Scope

Experiments ran on 2026-10-25 in Asia/Manila, with backend timestamps on 2026-10-24 UTC. They used a
new zero-based budget named `BeBu Allocation Lab 2026-10-25` and invented account funds. Primary's
financial state was not changed during these investigations. The browser was returned to Primary,
October 2026. The lab remains available for implementation validation.

The lab initially contained July through November 2026, despite October being the current month. A
latest-materialized-period restriction would reject even this newly created native budget. The
manual writer needs its own period policy instead of inheriting the target preview's restriction.

The [sanitized evidence](fixtures/allocation-writes-2026-10-25.json) contains six selected
before/after cases and protocol results. It removes identities and replaces generated identifiers
with aliases. It is not a complete backend export. Full local snapshots and temporary probe scripts
remain under `/tmp/bebu-allocation-investigation/`. That directory includes a private session file;
do not copy the directory into the repository.

## Findings

### Native Manual Saves

An ordinary native save from `0` to `10000` minor units changed these fields:

- Selected period: category `allocatedAmount`, `updatedAt`, and `lastUpdateChangeSource=USER`.
- Category stash: `historicalAllocations.2026-10`.
- Budget root: a new MANUAL history entry and `changeSource=USER`.
- Later period and category historical carryover: derived synchronization effects.

The native marker could not be enumerated: listing `saveMarkers` returned `403 PERMISSION_DENIED`.
Known marker reads and controlled native-shaped marker creation succeeded. Current artifact analysis
independently retains the fourth client write: server `createdAt` and client expiry after 30 days.

History stored the actual before/after allocations, empty `accountId` and `linkedCategoryId`, and
null `undoneAt`. Period `allocationAmount` remained `100000`. The account and canonical transactions
remained unchanged. The allocation is absolute; reducing it releases category assignments without
changing account money.

### Linked Savings And Archived Accounts

A native linked-category save from `0` to `-2500` succeeded with one active savings account. It
produced ordinary MANUAL history with empty account/link fields. Account money and transactions
remained unchanged. November category carryover became `-2500`, and its unallocated carryover became
`87500`.

A second zero-balance savings account was created and linked through the native UI. A controlled
index patch then made it archived and removed its reverse link, preserving the category's forward
link. This reproduced the relevant anomaly; it does not establish how native archiving originally
produces that state.

With that configuration, a controlled four-document save from `-2500` to `0` succeeded while the app
was unloaded. A subsequent native save from `0` to `100` also succeeded. Both preserved the complete
accounts index, category links, and canonical transactions. November carryover followed the new
allocation.

The manual writer may support this narrow inactive-link exception, with an explicit diagnostic.
Require `archived=true`, zero cleared and uncleared balances, an empty reverse link, and no
conflicting account/category association. Preserve the discrepancy. Block missing accounts, nonzero
archived accounts, contradictory links, duplicates, and unknown account types. This exception does
not establish automatic linked-income creation, clearing, deletion, or account-matching semantics.

### Carryover And Server Synchronization

Controlled four-document saves ran with the app tab on `about:blank`:

- Ordinary allocation `10000 → 20000`: November category carryover became `20000`; unallocated
  carryover became `80000`.
- Ordinary allocation `20000 → -5000`: November category carryover became `-5000`; unallocated
  carryover became `105000`.

These observations establish propagation without an active app tab for this fixture. They do not
identify the deployed trigger or prove every carryover rule. The CLI should submit the direct save
and observe synchronization, without writing guessed later-period deltas.

A controlled `carryOverStrategy=NONE` setting did not clear the stored November carryover after
another save. Native November displayed zero funds for that category while retaining the stored
carryover in the unallocated calculation. Raw stored carryover therefore cannot always substitute
for native effective availability. Keep NONE outside the initial supported carryover contract.

The bounded evidence covers one existing later period, default ALL carryover, and no intervening
activity in that later period. Historical edits, multiple later periods, future materialization, and
later-period spending remain separate validation cases.

### Transaction And Permission Results

`beginTransaction` accepted Firebase ID-token authentication with App Check when explicitly
configured:

```json
{ "options": { "readWrite": { "concurrencyMode": "OPTIMISTIC" } } }
```

Default `readWrite: {}` returned `403 PERMISSION_DENIED`. Read-only begin/read/rollback succeeded.
An explicit optimistic transaction accepted the complete four-document allocation save, including
the masked budget-root history update. The current CLI root rejection is therefore a local
restriction for this tested write shape.

A control transaction read the root and accounts index, then wrote only root metadata and a marker.
It succeeded. Changing account notes after the transactional read caused the equivalent commit to
return `409 ABORTED`. The read-but-unwritten accounts index was protected.

Reading a missing marker did not stop a root-only transaction after another request created that
marker. Always create the operation marker with `currentDocument.exists=false` inside the financial
commit. Do not rely on a prior missing-document read for duplicate exclusion.

`batchGet` responses arrived out of order. An early harness incorrectly paired responses by position
and received `FAILED_PRECONDITION`, without applying writes. The corrected reader matches complete
responses by document name.

### Receipt And Recovery Limits

Native-shaped marker creation succeeded; duplicate create-only submission returned
`409 ALREADY_EXISTS`. A known marker was readable, and a missing marker returned `404 NOT_FOUND`.
Extra marker fields for intent hash, execution hash, and schema version returned
`403 PERMISSION_DENIED`. Do not assume deployed rules accept the agent's proposed payload-bound
remote receipt.

Use a durable local operation manifest plus a separately generated native marker for the initial
writer. The manifest binds the request to its immutable intent, snapshots, writes, history ID,
marker ID, and timestamps. This provides recovery on the same installation while that trusted record
survives. It does not provide permanent cross-device payload binding or recovery after local-record
loss.

Exact replay of controlled financial writes failed their version precondition and added no history.
These probes did not simulate a lost response or process crash. The transport failure and crash
matrix remains an implementation acceptance requirement.

## Initial Support Boundary

Enable live execution only after the acceptance checks below pass. The first persistence milestone
should support:

- One existing DEFAULT category in a flat, consistent zero-based budget without an active challenge.
- The current month in the saved user timezone, an existing category stash, and safe signed integer
  amounts.
- Default ALL carryover and the observed single-next-period case without intervening activity.
- Ordinary categories and validated savings links, including the explicit archived-zero exception
  above.
- Negative allocations, reductions that release funds, and a no-change result without writes or
  history.

Validate the entire budget pool, including categories outside the selected group. Do not reuse
target ordering, target eligibility, or the preview's blanket linked-category rejection. Unknown
pool membership or carryover semantics must return a specific unsupported reason. An unsupported dry
run may still report raw inputs, but must not present an executable plan.

Initially reject income and payment-category allocation, hierarchy, period creation, NONE carryover,
historical edits, and unsupported later-period activity. Keep undo, native reallocation, automatic
transaction allocation, smart execution, and bulk coverage outside this writer. These are distinct
workflows; chaining manual commands does not establish their native atomicity or history semantics.

Pool overdraft is a CLI policy decision, not a recovered prohibition on signed allocations. Default
to rejecting a positive delta that exceeds available funds. Allow reductions that improve an already
negative pool. Report this policy explicitly in previews.

### Primary Compatibility

A read-only CLI audit found eight child categories and four CREDIT_CARD_PAYMENT categories in
Primary. Primary Savings itself has `accumulationStrategy=FUND_OVERRUNS`. The current preview's flat
model rejects this budget before calculating its pool. Shipping only that model would not solve the
user's savings workflow.

Primary compatibility is required before calling the feature ready for this user. Extend read-side
pool construction to the recovered one-level hierarchy and payment-category presence. Validate
identities, group membership, orphan children, cycles, deleted entries, and computation flags. Build
parent and child contributions without counting displayed parent aggregates twice. Preserve signed
amounts and the INCOME-group exclusion described in
[Model Construction](architecture.md#model-construction).

Allow manual allocation to an ordinary FUND_OVERRUNS category only after its dedicated fixture
passes. Target eligibility exclusions must not become automatic manual-write exclusions. Payment
categories remain unsupported write targets; their presence must still produce a correct
whole-budget pool. Capture disposable fixtures for these combinations before enabling
Primary-compatible execution. The flat persistence milestone is useful infrastructure, but is not
completion of Primary support.

## Command Interface

The following syntax is proposed and is not currently available:

```sh
bebu allocations set CATEGORY_ID --month 2026-10 \
  --amount-minor=-2500 --dry-run --full --plan-file ./allocation-plan.json

bebu allocations apply --plan ./allocation-plan.json --request-id REQUEST_ID

bebu allocations operation REQUEST_ID
bebu allocations recover REQUEST_ID
```

`set` initially provides planning only. `apply` becomes available after the writer's release gates
pass. Require `--dry-run` on the planner and an explicit reviewed plan on `apply`. Omitted or
misspelled flags must never select live execution. Writing a private local plan file requires
`--plan-file`; previewing never changes financial state or user configuration.

Return allocation, availability, delta, pool before/after, history assessment, linked-account
diagnostics, and source versions. Include the exact writes under `--full`, supported scope, and a
plan hash. Exclude credentials, transaction identifiers, and authorization headers from saved plans.
Bind the plan to project, database, actor, budget, month, category, calculation policy, and
supported schema version.

At apply time, resolve an existing request before fresh financial validation. For a new request,
read a fresh transactional snapshot and compare all planning dependency versions with the reviewed
plan. Any changed dependency makes the plan stale. Do not silently recalculate a replacement
operation. The human review happens before beginning this short transaction.

## Implementation Sequence

### 1. Transport And Snapshot Reader

Extend `src/firestore/client.ts` with typed canonical errors and explicit begin/read/commit/rollback
operations. Use `documents:commit`, which is atomic. Do not use non-atomic `batchWrite`. Preserve
authentication and App Check on every request.

Decode `batchGet` by document name, including missing results, duplicate responses, and incomplete
responses. Preserve exact Firestore version timestamps without rounding through JavaScript `Date`.
Add strict safe-integer and timestamp validation beside the wire types in
`src/firestore/encoding.ts`.

Add a manual-allocation snapshot reader separate from `auto-allocation.ts`. Read the root first,
then resolve period and stash identities from that transactional root snapshot. Protect the period,
category stash, category/group index, accounts index, and saved timezone configuration. Include
every document used for validation, pool calculation, link policy, or propagation expectations.

Read existing later periods inside the transaction when their contents determine eligibility or
expected synchronization. Root/index reads protect map membership; listing only existing documents
outside the transaction does not protect additions. Do not reuse `MutationPlan` unchanged: it
rereads ordinary documents and drops unchanged dependencies.

### 2. Pure Planner And Write Compiler

Add a manual planner separate from positive target distribution. Calculate signed allocation,
availability, pool effects, and native history assessment with checked arithmetic. Use the formula
and source semantics in
[Allocation Persistence](allocation-persistence.md#direct-save-and-completion). Targets and equal
priority orders are irrelevant to an absolute manual amount.

Compile only the validated four-document write set. Permit the selected root narrowly: the new
`allocationHistory.H` field and `changeSource`, with a version precondition. Require exact
period/category/month masks and a generated create-only marker. Reject root replacement, unrelated
masks, deletions, extra transforms, and writes outside the selected budget. Keep ordinary client
root restrictions intact for other write paths.

Generate history and marker IDs independently. Fix timestamps and expiry once per operation. Use
native 30-day marker expiry; keep expiry unchanged on retries. Preserve unrelated history and fail
on size limits rather than pruning native records.

### 3. Durable Operations And Recovery

Add allocation-specific operation storage under the existing private data directory. Use private
permissions, exclusive request binding, a process lock, file synchronization, atomic rename, and
directory synchronization. Store immutable intent and execution hashes, the reviewed dependency
versions, exact writes, and fixed generated IDs. Persist `prepared`, then `sending`, before issuing
the financial commit.

A matching local request returns its saved result. Different content under that request ID fails. A
missing or corrupt local record must never turn an uncertain prior request into a new operation.
Retain request tombstones after pruning larger manifests. Reject untracked marker identities rather
than assuming payload identity.

Distinguish acknowledged commit, definite rejection, stale/conflicted plan, unknown outcome, and
synchronization still pending. Treat timeout, connection loss, unreadable acknowledgment, and
ambiguous server errors as unknown until reconciled. Only authoritative `404 NOT_FOUND` means marker
absence; permission and transport errors remain visible.

A missing marker while a commit may still be running does not authorize a replacement operation. For
the first release, recovery observes the fixed marker and reports uncertainty; it does not
automatically resend uncertain work. Never resend an expired transaction ID, remove transaction
protection, generate replacement IDs, or replan an unknown operation. A definitive conflict can use
a new transaction only if the immutable reviewed dependencies still match.

A present native marker plus the trusted immutable local manifest supports local reconciliation
under the generated-marker identity assumption. Report that guarantee precisely. Do not claim a
payload hash exists remotely or return marker time as exact `commitTime`. TTL configuration and
actual deletion timing remain unverified; absence after expiry cannot establish that a request never
committed.

### 4. CLI And Synchronization Results

Register planning, apply, operation inspection, and recovery in `src/cli/app.ts`. Use domain modules
for arithmetic, compilation, operation storage, and recovery rather than expanding the CLI handler.
Add payload schemas and generate command guidance through `src/cli/skills.ts`. Preserve current
transaction-allocation guards.

After an acknowledged save, reread the selected category, history, account links, account balances,
and relevant later-period carryover. Use a bounded synchronization wait. A delayed derived update
must return `committed` with synchronization pending, never resubmit. Later observation or recovery
can finish verification without another financial write. If concurrent activity prevents
attribution, report that limitation instead of declaring a propagation failure.

### 5. Primary Compatibility And Account Matching

Complete the Primary pool-model and FUND_OVERRUNS acceptance cases described above. Compare the
complete read-only pool against the native app before permitting that budget's first CLI save. After
manual persistence passes, add a dedicated account-matching planner using the same safe operation
path. Calculate the required allocation inside the CLI:

```text
allocation = chosen account funds - carryover - other + spent
```

For the initial mode, require one active savings account and use its cleared balance. Require
explicit aggregate semantics before supporting several active accounts. Report uncleared balances
separately. The archived-zero exception contributes no funds but remains visible and protected in
the read set. Never change account money or repair links as part of matching.

Implement native reallocation and “cover overspending, then fund Primary” as a later explicitly
modeled workflow. Capture their transaction/history contract before enabling execution. Do not
approximate them through a sequence of manual saves. Historical writes and undo need separate
propagation and partial-completion fixtures.

## Acceptance Checks

Planner tests must catch wrong signs, overflow, carryover/other/spending omissions, wrong pool
membership, and incorrect overallocation history. Use literal expectations from the sanitized
fixtures rather than recomputing expectations through the planner. Test malformed IDs, conflicting
links, the archived-zero exception, absent metadata, unsupported settings, and unchanged
allocations.

Compiler tests must catch missing companion writes, extra writes, root replacement, incorrect masks,
and account or transaction modifications. Transport tests must catch unordered or incomplete
`batchGet`, typed error loss, absent transaction protection, and rounded versions.

Recovery tests must use real operation storage and cover concurrent processes, changed-payload ID
reuse, corrupt records, and crash boundaries. Simulate response loss after server acceptance, denied
marker reads, in-flight absence, expired transactions, and missing expired receipts. Assert one
history effect and fixed IDs across restart. An unknown result must never trigger an extra financial
attempt.

Disposable deployed checks must confirm the four-document save, positive and negative linked saves,
archived-zero preservation, and selected-period identity. Extend contention checks to every read
dependency, including root period mapping and category/account membership changes. Existing
account-index contention evidence does not substitute for those cases. Confirm current-month
synchronization in the exact enabled future-period configuration, including negative results.

Broader live support requires new fixtures for multiple future periods, intervening spending, future
materialization, and each additional carryover policy. Cross-device recovery requires an accepted
shared payload-bound receipt or trusted backend contract. A live permission rejection must remain
explicit; do not try alternate storage paths to evade deployed rules.

Run focused behavioral tests, then repository type, lint, and formatting checks. Regenerate command
guidance only when implementing command definitions or guidance changes. This investigation changes
documentation and sanitized evidence only; it adds no production command.

## Estimate And Delivery

Allow approximately 8–12 engineering days for the bounded manual writer, including failure tests and
deployed validation. The transport and compiler can follow the validated protocol without another
broad architecture investigation. Allow another 2–4 days for Primary's hierarchy, payment-presence,
and FUND_OVERRUNS fixtures and model support. Account matching adds approximately 1–2 days after
manual persistence passes. The estimate for useful Primary support is therefore approximately 11–18
engineering days. Broader carryover, reallocation, undo, and smart execution require separate
estimates after their fixtures exist.

Deliver in this order: transport/reader, manual preview/compiler, durable operations, bounded live
apply, Primary compatibility, then account matching. Each stage should remain independently
reviewable. Keep execution disabled until its acceptance cases pass.

## Sources And Artifact Identity

The current main module is
[`64da0a2cd0fe10bc31cb.wasm`](https://app.beyondbudgetapp.com/64da0a2cd0fe10bc31cb.wasm), 35,524,906
bytes. SHA-256: `72fe8d2a10be04dcc5b19b0b8d30bff119c82a12aa920ae500b0dd995e6ab2a4`. Decoded WAT
SHA-256: `55a38446ec8231e9b169c01b243e6970fa39f0c200adaee7fab17b751dcfb93c`.

`wasm-tools 1.262.0` decoded the module. Current functions 44161, 44153, and 44154 retain the direct
writer, history construction, and masked root-history update. Function 37827 drops the asynchronous
coordinator's returned handle. These are bounded current-artifact traces, not a full parity claim.
No new REA evidence record was generated. The [earlier reconstruction](source-reconstruction.md)
records the unavailable REA/WABT routes.

The concurrency agent reviewed official protocol sources without changing files or accessing private
financial state. The live probes validated the proposed optimistic option and narrowed the receipt
proposal after deployed rules rejected extra fields.

- [Live REST discovery schema](https://firestore.googleapis.com/$discovery/rest?version=v1) and
  [official transaction protobuf](https://github.com/googleapis/googleapis/blob/master/google/firestore/v1/common.proto):
  explicit optimistic concurrency support.
- [REST authentication](https://firebase.google.com/docs/firestore/use-rest-api) and
  [transaction isolation](https://firebase.google.com/docs/firestore/transaction-data-contention):
  authorization and read protection.
- [Batch get](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/batchGet),
  [commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit),
  and [Write](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write): response
  ordering, atomicity, masks, and preconditions.
- [Canonical errors](https://github.com/googleapis/googleapis/blob/master/google/rpc/code.proto),
  [transaction limits](https://firebase.google.com/docs/firestore/manage-data/transactions#transaction_failure),
  and [TTL](https://firebase.google.com/docs/firestore/ttl): ambiguous outcomes and retention
  boundaries.

Public references do not reveal deployed Beyond Budget rules, TTL settings, or server-trigger
implementation. Runtime acceptance applies to the tested budget, identity, and exact write shape.
