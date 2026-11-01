# Native Bulk Category Edit Readiness

Retained client code does not establish a bulk route around legacy or reconciliation guards. The
category branch copies a calculated transaction, then uses the ordinary transaction updater.
Applicable runtime evidence is still required before extending migration eligibility.

## Retained Contract

This trace uses the module and WAT hashes in [Source Reconstruction](source-reconstruction.md). The
investigation checked those hashes and read focused existing excerpts. It performed no native
action, authenticated read, support request, or new carryover investigation.

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

Consequently, bulk editing cannot yet promise preservation of missing allocation fields, raw link
representations, reconciliation state, or creator metadata. It also cannot resolve a genuine
saved/current-link conflict by assumption. The canonical old record and calculated replacement must
both be verified in a controlled fixture.

## Required Legitimate Lab Fixtures

Each fixture requires complete consistent snapshots of all budget collections and original complete
acknowledgments. Secondary payee, tag, debt, shopping-list, and unreferenced category stashes are
part of that coverage. Direct and history saves require separate evidence when both occur.

| Fixture                             | Legitimate Setup                                                                                                               | Required Category-Edit Observation                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Complete generic-account expense    | Existing native completed, cleared, editable expense with explicit flags/version and agreeing reciprocal savings links         | Preserve account money, amount/date, source links, flags, funding records, history, and unrelated values                |
| Missing autoAllocateIfIncome alone  | Naturally occurring editable legacy record, or native import/restore that preserves that exact omission                        | Determine whether the field remains absent; reject promotion if native decoding materializes an unknown value           |
| Reconciled expense                  | Reconcile a separate known expense through the native UI and retain that acknowledgment first                                  | Preserve reconciliation flag/timestamp, identity, account money, and links; observe native permission or no-op behavior |
| Genuine saved/current-link conflict | Create a separate native linked-account expense, then change the account link through a verified native configuration workflow | Establish whether bulk editing preserves the original saved target; a refreshed link fails the preservation requirement |
| Editable positive refund            | Existing legitimate positive editable OUTFLOW/REFUND with explicit flags and reciprocal card link, or matching native import   | Verify signed category effects while preserving account money, reserve, subtype, editability, and links                 |
| Immutable refund                    | Separate native refund created through its ordinary refund flow                                                                | Establish native refusal/no-op without changing editability or replacing the transaction                                |

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

The static contract supplies candidate paths and fixtures. It enables no bulk CLI writer or new
production category-edit family. Unknown outcomes retain their original identity and require
observation; current values cannot replace an original acknowledgment.
