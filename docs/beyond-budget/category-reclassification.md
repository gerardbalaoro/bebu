# Category Reclassification

Use `transactions reclassify` to move one completed expense between categories without rebuilding
its transaction model. Pass an explicit budget, expected source category and destination category.
Review `--dry-run --full` before a live command.

## Stored-Field Preservation

The canonical write mask contains only `targetTo.id`. Amount, account, date, reconciliation,
creator, allocation flags, version, split identity and unknown fields retain their original wire
values. Missing fields stay missing. Null values stay null.

This is a separate writer, not a relaxed general transaction update. The native editor rebuilds a
calculated model, whose default encoding can change legacy omissions. This writer avoids that
normalizer. Preservation follows from the masked write and raw-preview copying, not an assumption
about a missing boolean's meaning. General update and deletion guards remain unchanged.

## Direct Effects

For stored amount `n`, category spending changes by `n` at the source and `-n` at the destination.
The same signed changes apply to monthly category spending histories. Purchases have negative
amounts; posted refunds have positive amounts and subtype `REFUND`.

Source category usage and completed-preview counts decrease by one. Destination counts increase by
one. The source preview moves to the destination with its new category ID. The original raw preview
preserves unknown fields and timestamp precision. Existing shared previews in global, period,
account, payee and tag indexes receive the new category ID.

If an existing preview has a different date, the canonical timestamp supplies its corrected date.
The preview lists `dueAt` in `correctedPreviewFields`. The canonical date never changes. Other
missing shared previews remain absent. Category activity timestamps update with the reassignment.

Account money, payment reserve, account counts and account histories receive no writes. Funding,
allocation caches, root reallocation history, obligations, targets and configuration remain
untouched. Unlike the native remove/add handler, this net update does not refresh unrelated account
timestamps.

## Eligibility

The budget must be an identified ordinary zero-based budget without a challenge. The record must be
completed OUTFLOW. Purchases must be editable and negative. Posted refunds must be positive and have
subtype REFUND; their original editable flag remains unchanged, including false. This separate
attribution operation does not enable financial editing or deletion of a read-only refund.

Files, extra targets and sibling transaction links remain unsupported. Known DEBT extras require
matching stored debt identities and explicit totals; the debt record receives no write. Other extras
reject. A completed recurring occurrence can move without changing its schedule or future clone.

Source and destination categories must be active modifiable DEFAULT records without explicit account
links. The stored expense category target must have no linked account. An explicit reverse account
link to the destination rejects. Missing category/account link fields remain uninterpreted and
unchanged. Saved account links are never rebuilt or repaired. The account must use the budget
currency. Stored month, period and canonical date must agree in the saved budget timezone.

The source category requires an existing matching preview and explicit safe spending and counts.
Category preview counts must match their complete maps. An untouched destination with explicit zero
category usage may have its native empty stash shape. Native increment semantics create its first
count and spending entries; no missing historical balance is reported as zero. If complete
destination previews already contain expenses in the selected month, both period spending and
monthly history must be explicitly stored. Missing values then reject instead of becoming a new
spending total.

Reconciliation, creator and legacy allocation/version fields are preserved without participating in
allocation or account calculations. Malformed consumed fields still reject the operation. All money
changes and resulting counters must fit safe integers.

For a split, the snapshot must contain every member: 2–20 completed negative expenses sharing the
exact account, date and period. A canonical parent excludes the group. Only the selected canonical
member and its category indexes change. Sibling documents, portions and total remain unchanged.
Mixed-account, mixed-date, refund and incomplete groups stay unsupported.

## Historical Execution

The writer saves only direct category spending and index effects. It makes no future-period writes
or carryover repair. This bounded historical workflow follows the migration owner's account-balance
criterion; it does not restore previous category envelopes or redirect funding.

Later carryover remains a backend operation. `propagationVerified:false` means there is no terminal
backend receipt. Original commit acknowledgment and later observed state are separate evidence.
Check all original cleared and uncleared account balances, canonical fields and saved periods after
each historical operation. Stop on unexpected effects or an unknown submission outcome. Repeated
stable reads do not establish backend completion.

## Atomicity And Recovery

Root, category, account, canonical, index, period and split dependencies share one optimistic
snapshot. Version conflicts reject without retry. Permanent operation records bind the actor,
budget, action, original input and exact compiled body before dispatch.

New operations retain validated complete acknowledgments with the submitted-body hash. This local
record does not create a payload-bound remote receipt. Existing records without acknowledgment files
retain their previous recovery semantics. Operation and recovery commands observe only; unknown or
sending requests must never be replayed or replaced.

## Validation

A native reconciled card category edit retained its original 22-write acknowledgment and complete
lab snapshots. Only the canonical category changed; account money, reserve, reconciliation and other
financial fields stayed fixed. A subsequent CLI net update retained its complete nine-write
acknowledgment. The full lab snapshot showed the expected spending, counts, preview membership and
December carryover, with all accounts, existing funding and unrelated records unchanged.

Actual CLI lab commands also changed one reconciled split member and a genuine native-created
read-only refund. Full 96/97-document comparisons retained every sibling and account value. The
refund remained editable:false. Each command retained its original complete nine-write REST
acknowledgment. These tests validate the separate masked writer, not native bulk eligibility.

The runtime write allowlist rejects any unexpected document, field mask or signed transform before
commit. It excludes account money, reserve, allocation, root history and unrelated canonical fields.

Regression tests cover raw omission/null preservation, signed refund spending, complete split
membership, stale preview dates, source intent, counter overflow, conflicting previews and links,
atomic version protection, complete acknowledgment and zero replay after conflict or uncertainty.
These are writer guarantees; they do not claim the native legacy normalizer was validated.
