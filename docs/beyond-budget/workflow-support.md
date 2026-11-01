# Native Workflow Support

This guide distinguishes enabled operations from remaining migration limits. Use the generated
[command reference](../../skills/bebu/SKILL.md) for syntax and the exact supported subsets.
Historical funding changes remain blocked when later saved periods exist.

## Enabled Operations

| Operation                       | Command Or Behavior                                                                           | Boundary                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Category rename                 | `categories rename ID --name NAME --budget BUDGET --dry-run`                                  | Active DEFAULT category with explicit `modifiable:true`; name only                                        |
| Ordinary category creation      | `categories create --budget BUDGET --group GROUP --name NAME --icon ICON --color COLOR`       | Nonempty flat ordinary group, explicit unique peer orders and existing style codes                        |
| Group lookup and rename         | `groups list`; `groups rename ID --name NAME --budget BUDGET --dry-run`                       | Same conservative CLI eligibility; no creation or hierarchy changes                                       |
| Direct category hierarchy       | `categories attach ID --parent PARENT_ID`; `categories detach ID --parent EXPECTED_PARENT_ID` | One level, same group, ordinary modifiable family; no targets, explicit policy settings, or account links |
| Target removal                  | `targets remove CATEGORY_ID --budget BUDGET --dry-run`                                        | Complete positive SPENDING/MONTHLY target on a flat, active, modifiable ordinary category                 |
| Target creation and editing     | `targets create CATEGORY_ID`; `targets update CATEGORY_ID`                                    | Explicit positive minor-unit amount and ALL/NONE target carryover; same category subset                   |
| Bounded category reallocation   | `allocations reallocate --from SOURCE --to DESTINATION --amount-minor AMOUNT --month YYYY-MM` | Latest saved current/future month, explicit operands, flat unlinked categories, small complete indexes    |
| Nullable transaction creator    | Preserve explicit `createdBy:null`                                                            | Other financial, reconciliation, and editability checks still apply                                       |
| Legacy card link representation | Preserve explicit null link type and version                                                  | Saved/current card and reciprocal payment-category links must otherwise agree                             |
| Durable transaction inspection  | `transactions operation REQUEST_ID --budget BUDGET`                                           | Trusted records from this installation                                                                    |
| Transaction outcome observation | `transactions recover REQUEST_ID --budget BUDGET`                                             | No resend; native markers and current versions cannot prove an unknown outcome                            |

Rename reads and commits use one Firestore transaction. Each name patch retains unrelated fields and
carries the index version precondition. Names use a CLI limit of 1–200 trimmed characters. This
limit and the DEFAULT/modifiable subset are CLI policies, not recovered native restrictions. After
marker-only confirmation, inspect the current name instead of assuming the rename succeeded.

Target removal deletes the complete target field. It preserves account links without interpreting
missing values. It does not directly write funds, accounts, history, or transaction records.
Removing target demand intentionally changes future suggestions and automatic funding decisions.
Savings, repeating, snoozed, hierarchical, and incomplete target shapes remain unsupported.

For creation or editing, pass `--amount-minor AMOUNT --carry-over ALL` or `--carry-over NONE`. Use
an explicit budget and review `--dry-run --full` first. Creation requires an absent target field.
Editing requires the complete known target shape, without unknown fields, and a native whole-second
timestamp. Both operations replace the complete target. They preserve category settings and raw
account links without interpreting them. The target carryover setting changes demand; it does not
change category carryover or saved funds.

Native spending-target edits renew `createdAt` from the current clock. The CLI follows this behavior
at whole-second precision. The preview shows the complete previous and proposed targets, including
timestamps. An unchanged amount and policy skip the save. After an uncertain outcome or marker-only
confirmation, inspect `targets list` before another command. Do not blindly retry.

For hierarchy changes, use an explicit budget and review `--dry-run --full` before saving. Detach
requires the expected current parent; attach requires a top-level source and intended top-level
parent. The source must have no children. The entire affected family must be active, modifiable
DEFAULT categories in one active DEFAULT group. Target, aggregation, accumulation, and computation
settings exclude the family, including explicit inactive settings. Each account must provide
explicit link evidence. Family account links, malformed link lists, and incomplete account evidence
block execution. Absent category link lists remain absent. No missing financial field receives a
default.

Hierarchy reads and commit share one optimistic transaction. Map identities, graph consistency,
explicit safe orders, and sibling order uniqueness are checked. Attach writes the child’s parent and
group fields. Detach deletes the parent field. Neither operation changes order or stores financial
amounts. Parent coverage membership intentionally changes. Future funding outcomes remain
unpredicted, and broader aggregation or coverage workflows remain unsupported. After an uncertain
outcome or marker-only confirmation, inspect `categories list --full` before another command. Do not
blindly retry.

## Native Evidence

The function numbers below refer to the artifact identified in
[Source Reconstruction](source-reconstruction.md). The findings come from indexed WAT inspection,
not recovered server source.

| Native Functions                              | Contract                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| 50480 → 50452 → 50438 → 51368                 | Category presentation patch in the discovered category index                            |
| 50583 → 50582 → 50576 → 51323                 | Group name patch                                                                        |
| 77053 → 77066 → 77071 → 50446 → 50468 → 50485 | Confirm target removal and delete `data.categories.<id>.target`                         |
| 77068 → 44701; 49244 → 44701                  | Initialize monthly spending targets and rebuild their creation timestamp from the clock |
| 49243 → 53511; 50485 → 50452                  | Serialize the complete target with timestamp values and save only the target field      |
| 66215 → 50463 → 50481                         | Detach deletes the parent field; group and order stay unchanged                         |
| 66214 → 50464 → 50482                         | Attach writes the parent and parent’s group; no order or ledger writes                  |
| 48948, 51690                                  | Nullable creator decoding and preservation during serialization                         |
| 49253                                         | Null creator produces a null preview creator ID                                         |
| 51758                                         | Card reserve effects consume saved card type and payment-category ID, not link type     |
| 51847 → 51849                                 | Explicit null version prevents this linked-allocation predicate                         |

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

Additional native and CLI create/edit/remove experiments captured 75 budget, stash, period, and
canonical transaction documents. Each save changed only the selected target. All 75 document values
matched their baseline after cleanup. The monthly spending branch does not read the saved creation
timestamp when calculating demand. Other schedules can consume that timestamp and remain
unsupported.

Native and CLI detach produced equal document values. Native and CLI reattach restored all 75
documents after synchronization. Attaching a second sibling through the CLI and detaching it
natively also restored every document and the exact category-index wire fields. The native path
permits more cases than the CLI. The CLI family, link, graph, and ordering checks define its
conservative subset.

## Category Reallocation

Use `allocations reallocate` with an explicit budget and review `--dry-run --full` first.
[Reallocation Writer](reallocation-writer.md) describes the native evidence, exact effects, and
limits. The CLI saves both native logical components in one optimistic transaction, including their
history. A complete acknowledgment covers the whole envelope. An uncertain outcome never starts a
second phase or a replay.

The initial subset requires explicit financial operands and complete, small, explicitly untrimmed
indexes. Sparse native records remain blocked without defaults. This capability does not repair the
migration discrepancy or authorize its held transfer.

## Durable Transaction Recovery

Live create/update/delete/reallocate requests now claim a permanent local identity before financial
planning. The identity binds actor, project, budget, action, transaction, and normalized original
input. Private operation files retain the exact compiled body, hash, fixed IDs, and dispatch state.
Exclusive claims, private permissions, and synchronized files/directories preserve the boundary
across concurrent callers and crashes. Keep `BEBU_HOME` and its permanent records.

Dry runs reserve no request. Existing live requests only observe, including acknowledged or rejected
requests. Changed payloads, actions, or budgets cannot reuse the same request ID. Recovery never
resends financial writes.

Recovery reports the marker and up to 50 current submitted-document versions and precondition
comparisons. Remaining observations are counted. These reads are not one consistent snapshot and do
not establish an unknown commit outcome. Native error codes remain in `commitDiagnostic`, separate
from local status. Only a valid original acknowledgment with one write result per submitted write
establishes a committed state. Missing or malformed acknowledgments remain unknown. Recovery also
observes submitted budget-root history versions.

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
| Allocation-aware category moves | Bounded monitored native category edits verified; CLI allocation guards and broader reversal workflows remain                                  |
| Genuine account-link conflicts  | No repair or forced account reassignment; only the verified null representation is accepted                                                    |
| Split changes                   | Bounded two-member native group verified; CLI creation/editing, arbitrary groups, and conflict handling remain unsupported                     |
| Noneditable refunds             | Ordinary native category handler retains the original record; no alternative reassignment contract established                                 |
| Other category/group lifecycle  | Group creation, empty groups, cross-group moves, archive, ordering, subtrees, targeted or linked families, and aggregate/coverage settings     |
| Other target workflows          | Savings, repeating, snoozed, hierarchical, incomplete, unknown-field, and non-native timestamp cases; broader removal subsets                  |
| Broader reallocation            | Historical propagation, linked/targeted/hierarchical categories, sparse operands, large or trimmed indexes, and undo remain unsupported        |
| Shared recovery                 | No payload-bound remote receipt or cross-device/crash proof after local-record loss                                                            |

Native bulk category update 52151 does not itself exclude splits or reconciled records. That is not
a complete sibling or reconciliation persistence contract. Those existing CLI guards remain. Do not
strip split IDs, clear reconciliation/editability flags, invent allocations, or repair carryover
through unrelated savings or reallocation operations.

## Validated Category Creation

[Ordinary Category Creation](category-creation.md) records native and deployed CLI evidence. The
command creates one ordinary category and an empty stash, with durable request binding and complete
acknowledgment checks. Complete lab comparisons preserved existing financial values. Group creation,
empty groups, hierarchy, and other lifecycle operations remain outside this subset.

## Monitored Native Category Edits

[Native Category And Split Edits](native-category-edits.md) records bounded disposable-lab evidence.
An allocation-capable generic-account expense retained its existing funding and history during a
category-only edit. A two-member split retained both identities, amounts, and its shared split ID.
Both saves preserved account money and explicit financial flags and links.

These findings support matching individually monitored native actions under explicit user
authorization. They do not enable CLI execution through existing historical, allocation, or split
guards.

An imported positive card refund with explicit editable:true differs from a native immutable refund.
The existing CLI category-update path preserves its sign and editability. A focused regression
verifies unchanged account money, reserves, and flags. Historical funding guards remain, and no
positive-refund native runtime workflow is claimed.
