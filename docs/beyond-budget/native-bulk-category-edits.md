# Native Bulk Category Edits

Native bulk category edits have bounded lab evidence for complete split, reconciliation, and
saved/current-link conflict cases. Each action preserved account money, flags, saved links, and
existing funding/history. CLI split, reconciliation, link, allocation, and historical guards remain
unchanged.

## Retained Contract

This trace uses the module and WAT hashes in [Source Reconstruction](source-reconstruction.md). The
static trace checked those hashes and read focused existing excerpts. Runtime validation below used
the authorized disposable lab. No Primary write, support request, or carryover reinvestigation
occurred.

Bulk continuation 52151 reads the transaction model through 52131 with a five-second timeout. The
model stream predicate references the fromCache field. This does not establish a terminal downstream
completion signal.

For CategoryUpdate, struct 7274, the branch requires an editable OUTFLOW and a nonblank selected
category ID. It constructs the destination through 49217 and copies the model through 45778. The
copy mask changes the destination while retaining other calculated model fields. The category branch
has no additional subtype exception for immutable refunds.

The inspected branch does not explicitly exclude reconciliation or split membership. That
observation does not establish downstream eligibility or complete sibling persistence. Those cases
retain their CLI guards.

If the model changes, continuation 52151 calls `52092 → 52065`. A category update does not select
the metadata-only shortcut. The normal expense handler therefore removes and adds ledger effects,
maintains indexes, and saves a replacement canonical record.

The shared update normalizer `51700 → 51690` constructs a DTO from calculated model fields. It
consumes version and allocation booleans, serializes targets through 49215, and applies version
handling through 51845. Copying a boolean value does not preserve the distinction between an absent
raw field and a model value supplied during decoding.

Consequently, bulk editing cannot promise preservation of missing allocation fields, unknown link
representations, broader reconciliation state, or unknown creators. The bounded conflict fixture
below retained an explicit saved link. The canonical old record and calculated replacement require
separate verification for other shapes.

## Verified Single-Child Split Category Edit

The native route is Transactions, More options, then Bulk update. Select exactly one known split
child, enable only Category, choose its reviewed destination, and review the one-transaction
confirmation. This route uses individual transaction selection without opening a partial group
editor.

The lab fixture was a complete known two-member expense split with one account and date. The
selected child had explicit completed, cleared, editable, unreconciled state, version 1, both
allocation flags true, and an agreeing reciprocal SAVINGS link. Both portions and the total were
known before submission.

The original acknowledgment contained 22 write results. Complete expected-value and raw-wire
comparisons covered all 90 documents, six saved months, and all 12 canonical transactions. The
selected canonical record changed only its category ID. The sibling's raw document and version
remained identical. Shared split identity, portions, total, source account, dates, flags, links,
existing funding records, allocations, and root history remained unchanged. Spending, usage counts,
previews, and later carryover reflected the selected expense's category change.

This establishes the matching monitored native action. Later authorized migration evidence also
covered twelve complete older children absent from the trimmed global preview stash. Advanced search
used an exact date range and Include categories. The search-results More options menu supplied a
second Bulk update entry with the actual filtered results. Exactly one known child remained
selected, with only Category enabled. Its sibling's raw document and version stayed unchanged in
each save.

Those selected records also renewed a known creator's null email to the same signed-in creator's
email. UID, display name, photo, and explicit stability:0 stayed unchanged. This does not cover an
unknown or null creator. The cause of incomplete group-editor hydration remains unproved.

Repeated categories, mixed accounts, unknown portions, incomplete records, and other split families
remain separate cases. Never submit a partial group editor or insert missing production previews.

## Verified Reconciled Expense Category Edit

A separate known ordinary expense first used the native Reconciled control. Its complete original
22-write acknowledgment established reconciled:true. The action retained the explicit
reconciledAt:null value and preserved account money. No balancing entry was created.

A later native bulk category-only action selected that reconciled expense. The record had explicit
completed, cleared, editable state, version 1, both allocation flags true, and agreeing reciprocal
SAVINGS links. Its original acknowledgment also contained 22 write results.

Complete comparisons covered all 90 raw documents, six saved months, and all 12 canonical records.
Only the selected canonical category changed. Reconciliation remained true, its timestamp remained
null, and all other flags, versions, amounts, dates, identities, and saved links remained unchanged.
Existing funding records, allocations, root history, account money, and unrelated values were
preserved. No new financial record appeared.

This original fixture supports the matching individually monitored native action. Further fixtures
cover the separate cases below. Non-null reconciliation timestamps, missing financial fields,
unknown creators, and positive refunds remain unverified. Do not clear reconciliation to make a
record eligible.

## Verified Reconciled Split And Card Expenses

A later lab fixture used the native Reconciled control on both members of the known two-expense
SAVINGS split. Each control save retained its original 22-write acknowledgment and explicit null
reconciliation timestamp. Both members retained version 1, explicit true allocation flags, and
agreeing reciprocal savings links.

A native Category-only bulk action then selected one child. Its original acknowledgment contained 22
write results. Independent expected-value and raw-write comparisons covered all 93 documents, 14
canonical records, and six saved months. Only the selected canonical category changed. The sibling's
raw document and version stayed identical. Both reconciliation flags and null timestamps, shared
split identity, portions, total, accounts, saved links, and existing funding/history stayed
unchanged.

A separate native card expense used the native Reconciled control, then one Category-only bulk
action. Both original acknowledgments contained 22 write results. The expense had explicit
completed, cleared, editable, reconciled state, a null reconciliation timestamp, version 1, and true
allocation flags. Its saved card payment link agreed with the current reciprocal link.

Full comparisons covered all 95 documents, 16 canonical records, and six saved months. Only the
selected canonical category changed. Account money, payment reserve, flags, timestamps, saved links,
existing funding records, allocation caches, and root history stayed unchanged. Neither category
edit created a financial record. These contracts exclude non-null reconciliation timestamps,
incomplete fields, unknown creators, refunds, conflicting links, and other split families.

## Verified Explicit Saved/Current Link Conflict

A separate native SAVINGS account first linked to category A through Link category. A native
completed, cleared, editable expense retained A in its saved source target. The native Link new
category action then linked the account to B. Both link saves retained original three-write
acknowledgments. Full comparisons proved that relinking changed only the reciprocal links and
preserved every canonical record and version.

The expense then used one native Category-only bulk action. Its saved source link still named A,
while the account and B retained their current reciprocal link. The original acknowledgment
contained 22 write results. Full comparisons covered all 93 documents, 14 canonical records, and six
saved months. Account money, flags, version, amounts, dates, existing funding records, allocation
caches, and root history stayed unchanged. The selected canonical category changed, and its null
creator email renewed to the same verified creator's email.

This supports the matching complete ordinary native expense with an explicit old category link and
an explicit different current reciprocal category link. The fixture had version 1, true allocation
flags, no split, no reconciliation, and no allocation extras. It does not cover an absent account
link, incomplete version, missing flags, unknown creator, refund, or combined unsupported condition.
The CLI link-conflict guard remains unchanged.

## Fixture Coverage And Remaining Requirements

Each fixture requires complete consistent snapshots of all budget collections and original complete
acknowledgments. Secondary payee, tag, debt, shopping-list, and unreferenced category stashes are
part of that coverage. Direct and history saves require separate evidence when both occur.

| Fixture                             | Legitimate Setup                                                                                                             | Required Category-Edit Observation                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Complete generic-account expense    | Existing native completed, cleared, editable expense with explicit flags/version and agreeing reciprocal savings links       | Preserve account money, amount/date, source links, flags, funding records, history, and unrelated values             |
| Missing autoAllocateIfIncome alone  | Naturally occurring editable legacy record, or native import/restore that preserves that exact omission                      | Determine whether the field remains absent; reject promotion if native decoding materializes an unknown value        |
| Reconciled expense                  | Ordinary SAVINGS, ordinary card, and complete two-expense SAVINGS split subsets with explicit null timestamps verified above | Preserve reconciliation flag/timestamp, sibling raw state, identity, account money, reserve, and links               |
| Genuine saved/current-link conflict | Complete ordinary SAVINGS expense and native reciprocal relinking verified above                                             | Preserve the explicit original saved link and the explicit different current link; other representations remain held |
| Editable positive refund            | Existing legitimate positive editable OUTFLOW/REFUND with explicit flags and reciprocal card link, or matching native import | Verify signed category effects while preserving account money, reserve, subtype, editability, and links              |
| Immutable refund                    | Separate native refund created through its ordinary refund flow                                                              | Establish native refusal/no-op without changing editability or replacing the transaction                             |

Removing flags, altering saved targets, or forcing editability would invalidate these fixtures. The
earlier positive CSV preview produced Income and was canceled. It does not supply the editable
REFUND fixture. Ordinary native refund creation remains noneditable.

Missing-field and reconciled fixtures must start separately. A combined case cannot isolate whether
normalization, reconciliation, or link handling caused a difference. Known two-member split evidence
also does not establish bulk split behavior or mixed-account and partial-group cases.

## Acceptance And Execution Limits

The migration's authorized account-balance invariant permits changed category envelopes after a
legitimate native reclassification. It does not permit changes to transaction amounts, accounts,
explicit flags, saved links, or unresolved operation identities.

The verified subsets support matching individually monitored native actions under the migration
authorization. They enable no bulk CLI writer and remove no CLI guard. Missing fields, other link
representations, refunds, and broader reconciliation shapes still require legitimate matching
fixtures. Unknown outcomes retain their original identity and require observation. Current values
cannot replace an original acknowledgment.
