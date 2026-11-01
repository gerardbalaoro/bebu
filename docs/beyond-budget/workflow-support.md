# Native Workflow Support

This guide distinguishes enabled operations from remaining migration limits. Use the generated
[command reference](../../skills/bebu/SKILL.md) for syntax and the exact supported subsets.
Historical funding changes remain blocked when later saved periods exist.

## Enabled Operations

| Operation                       | Command Or Behavior                                                     | Boundary                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Category rename                 | `categories rename ID --name NAME --budget BUDGET --dry-run`            | Active DEFAULT category with explicit `modifiable:true`; name only                        |
| Group lookup and rename         | `groups list`; `groups rename ID --name NAME --budget BUDGET --dry-run` | Same conservative CLI eligibility; no creation or hierarchy changes                       |
| Target removal                  | `targets remove CATEGORY_ID --budget BUDGET --dry-run`                  | Complete positive SPENDING/MONTHLY target on a flat, active, modifiable ordinary category |
| Nullable transaction creator    | Preserve explicit `createdBy:null`                                      | Other financial, reconciliation, and editability checks still apply                       |
| Legacy card link representation | Preserve explicit null link type and version                            | Saved/current card and reciprocal payment-category links must otherwise agree             |
| Durable transaction inspection  | `transactions operation REQUEST_ID --budget BUDGET`                     | Trusted records from this installation                                                    |
| Transaction outcome observation | `transactions recover REQUEST_ID --budget BUDGET`                       | No resend; native markers and current versions cannot prove an unknown outcome            |

Rename reads and commits use one Firestore transaction. Each name patch retains unrelated fields and
carries the index version precondition. Names use a CLI limit of 1–200 trimmed characters. This
limit and the DEFAULT/modifiable subset are CLI policies, not recovered native restrictions. After
marker-only confirmation, inspect the current name instead of assuming the rename succeeded.

Target removal deletes the complete target field. It preserves account links without interpreting
missing values. It does not directly write funds, accounts, history, or transaction records.
Removing target demand intentionally changes future suggestions and automatic funding decisions.
Savings, repeating, snoozed, hierarchical, and incomplete target shapes remain unsupported.

## Native Evidence

The function numbers below refer to the artifact identified in
[Source Reconstruction](source-reconstruction.md). The findings come from indexed WAT inspection,
not recovered server source.

| Native Functions                              | Contract                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| 50480 → 50452 → 50438 → 51368                 | Category presentation patch in the discovered category index                        |
| 50583 → 50582 → 50576 → 51323                 | Group name patch                                                                    |
| 77053 → 77066 → 77071 → 50446 → 50468 → 50485 | Confirm target removal and delete `data.categories.<id>.target`                     |
| 48948, 51690                                  | Nullable creator decoding and preservation during serialization                     |
| 49253                                         | Null creator produces a null preview creator ID                                     |
| 51758                                         | Card reserve effects consume saved card type and payment-category ID, not link type |
| 51847 → 51849                                 | Explicit null version prevents this linked-allocation predicate                     |

The target-delete branch checks empty-target identity and category ID. It bypasses target
serialization and does not consume account links or call period/account/history companion writers.
The CLI still validates a known target shape before deletion. It assigns no missing defaults.

Card compatibility requires explicit nulls, unchanged nonblank payment-category ID, matching current
card identity/type, and reciprocal links to an active CREDIT_CARD_PAYMENT category. Unknown link
types, missing versions, genuine link changes, splits, and noneditable refunds remain guarded. The
canonical saved account target stays unchanged.

Controlled disposable-budget checks confirmed the name-only changes and target removal. After
restoring names and removing the temporary target, 73 captured budget documents matched their
original raw values. This is bounded runtime evidence, not proof of all future backend behavior.

## Durable Transaction Recovery

Live create/update/delete requests now claim a permanent local identity before financial planning.
The identity binds actor, project, budget, action, transaction, and normalized original input.
Private operation files retain the exact compiled body, hash, fixed IDs, and dispatch state.
Exclusive claims, private permissions, and synchronized files/directories preserve the boundary
across concurrent callers and crashes. Keep `BEBU_HOME` and its permanent records.

Dry runs reserve no request. Existing live requests only observe, including acknowledged or rejected
requests. Changed payloads, actions, or budgets cannot reuse the same request ID. Recovery never
resends financial writes.

Recovery reports the marker and up to 50 current submitted-document versions and precondition
comparisons. Remaining observations are counted. These reads are not one consistent snapshot and do
not establish an unknown commit outcome. Native error codes remain in `commitDiagnostic`, separate
from local status. Only the original exact acknowledgment establishes a saved committed state in
this implementation.

After an authoritative rejection, inspect fresh state and review a new dry run before using a new
request ID. For create, retain the resolved transaction identity/date from the original submission.
Sending or unknown outcomes require observation. Lost acknowledgment, local-record loss, old
untracked requests, marker expiry, and cross-device attempts remain uncertain without stronger
evidence. A replacement ID must not conceal an unresolved earlier outcome.

## Remaining Financial Workflows

| Area                            | Missing Evidence Or Limit                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Historical category funding     | Backend producer, preservation rules, past policy/adjustments, and completion signal; a zero residual does not certify correctness             |
| Legacy financial fields         | Missing allocation flags, link-type fields, versions, and creators remain unknown; explicit null creator support does not clear reconciliation |
| Allocation-aware category moves | Expense allocation history, reversal, index, and downstream funding contract                                                                   |
| Genuine account-link conflicts  | No repair or forced account reassignment; only the verified null representation is accepted                                                    |
| Split changes                   | Complete sibling snapshot, group totals, indexes, native runtime parity, and conflict tests                                                    |
| Noneditable refunds             | Ordinary native category handler retains the original record; no alternative reassignment contract established                                 |
| Category/group lifecycle        | Create, move, detach, archive, ordering, descendant and aggregate-target effects                                                               |
| Target creation/editing         | Typed native serialization, schedules, defaults, and runtime fixtures; removal is a separate operation                                         |
| Native reallocation             | Transaction/index/allocation effects plus separately saved MONEY_REALLOCATION history, with recovery across both save boundaries               |
| Shared recovery                 | No payload-bound remote receipt or cross-device/crash proof after local-record loss                                                            |

Native bulk category update 52151 does not itself exclude splits or reconciled records. That is not
a complete sibling or reconciliation persistence contract. Those existing CLI guards remain. Do not
strip split IDs, clear reconciliation/editability flags, invent allocations, or repair carryover
through unrelated savings or reallocation operations.
