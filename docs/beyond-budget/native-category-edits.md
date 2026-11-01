# Native Category And Split Edits

Individually monitored native category edits can preserve account money in the bounded cases below.
The CLI retains its allocation, split, and historical guards. These experiments do not establish a
general server propagation or completion contract.

## Evidence And Scope

Disposable-budget experiments on 2026-11-02 captured original native requests and streaming
WriteResponse frames. Complete consistent snapshots covered the root, all stashes, canonical
transactions, and all six saved months. Offline checks compared complete expected document values.
Raw comparisons retained unknown root fields, including saved-period orders.

| Action                                           | Original Acknowledgment                                     | Observed Result                                                        |
| ------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Historical generic-account expense category edit | 22 write results                                            | Same transaction and account money; spending and indexes moved         |
| Two-member split creation                        | 43 write results, plus two separate history acknowledgments | Two expense members and two automatic funding transfers                |
| Existing split member category edit              | 43 write results                                            | Both member identities, portions, total, and shared split ID preserved |

Each action used one submission. Later consistent reads supplied financial observations without
replaying a request. Read-only point-in-time root reads tied each split-creation history
acknowledgment to its complete intermediate document version.

## Allocation-Capable Expense

The fixture was a completed, cleared, editable, unreconciled OUTFLOW from a SAVINGS account. Its
GENERIC_ACCOUNT target retained an explicit reciprocal current category link. Both allocation flags
were true, version was 1, and extras were empty. It had no split, files, or extra target.

Native creation produced an expense and a separate automatic funding transfer. A later category-only
edit moved the expense to another ordinary category. The edit preserved the automatic transfer,
allocation history, linked funding category, historical allocations, account money, and account
links. It preserved the expense amount, date, version, explicit flags, and source target.

The native editor did not reverse or redirect existing funding. It moved spending, category usage
counts, category previews, and the destination in account/global/period previews. Later saved months
and category caches reflected the changed spending. The editor also renewed the same creator's
email.

This evidence covers the matching expense category edit. It does not establish amount/date changes,
deletion, allocation undo, nonempty allocation extras, unknown fields, reconciliation, or
conflicting links.

### Separate Saves And Historical Context

The fixture's creation used an October transaction date while the app displayed November. The
automatic transfer's canonical record named October, but its root history row named November. The
original history acknowledgment preceded the main batch acknowledgment. An intermediate snapshot
contained the history row before either new canonical record appeared.

Original acknowledgments and later reads resolved that observation without another submission. The
month mismatch is retained evidence. It does not justify changing history, inferring a general
history-period policy, or treating the native operation as one atomic save.

## Split Creation And Category Edit

The native form contained a known total of 300 minor units, with explicit portions of 100 and 200.
The categories had stored orders 9 and 4. Entry in that order succeeded without sorting the portions
or changing their category assignments. The form showed zero remaining before submission.

Creation produced two completed expense records with distinct IDs and one shared split ID. There was
no canonical parent transaction. Both siblingTransactionId fields remained null. The visible group
total was the sum of the two expense members. Automatic funding created two additional native
transfer records and two independent root history entries.

Opening one member and selecting Edit opened the complete group editor. Its per-row More options
menu provided Change category. Changing one member's category preserved both canonical IDs, the
shared split ID, dates, amounts, source account, explicit flags, links, and version.

The save rewrote both members and renewed their creator emails. The other member's financial data
remained unchanged. Account balances, existing funding records, allocations, and root history stayed
unchanged. Spending, category indexes, counts, and the later saved carryover reflected the edited
member.

This evidence covers a complete, known, same-account/date, two-member ordinary expense group. Mixed
accounts, partial sibling snapshots, repeated categories, reconciliation, recurring groups, refund
members, different dates, and unknown portions require separate evidence.

## Monitored Execution Requirements

1. Obtain explicit authorization for the native action and its financial acceptance criteria.
2. Capture every canonical record, stash, saved period, and raw root before the action.
3. Verify complete flags, versions, editability, reconciliation, and reciprocal saved/current links.
4. For a split, identify every member and verify the exact total and portions.
5. Review the full native editor and submit once.
6. Retain each original acknowledgment and its complete request body.
7. Verify the expected complete document state and the account balance invariant before another
   action.

If the user accepts changed category envelopes, account preservation does not require funding
restoration. Category balances must still have an explained native ledger effect. Unknown outcomes
retain their original identity and require observation. A marker, current values, or a transport
response alone does not prove an original acknowledgment.

Successful observations across saved months do not supply a terminal downstream receipt. Missing
financial fields, genuine link conflicts, immutable refunds, and unsupported split shapes remain
separate boundaries. Native card normalization does not establish generic-account defaults.

## Remaining Fixture Evidence

The lab had no existing editable positive OUTFLOW/REFUND fixture. A new native card account used an
explicit zero opening balance and preserved all existing lab records. A positive CSV entry reached
native review as Income. The preview was canceled without confirmation. All 89 lab documents then
matched their pre-import raw fields.

That preview does not establish the held editable refund's category-edit contract. Further evidence
requires a legitimate matching imported fixture or a native import configuration that produces it.
Ordinary refund creation remains noneditable. Changing that flag would invalidate the experiment.

The expense experiment used agreeing saved/current links. It provides no evidence for a genuine link
conflict. A controlled native account-link lifecycle and subsequent category edit still need
separate snapshots and original acknowledgments. Current links must not replace saved links merely
to pass a category-edit guard.
