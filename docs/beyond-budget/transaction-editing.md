# Transaction Editing

`transactions update` edits existing expenses, card refunds, income, and upcoming recurring
payments. The generated [command reference](../../skills/bebu/commands/transactions/update.md) lists
the fields and restrictions. `schema` provides the JSON contract. Amounts use positive integer minor
units; the CLI preserves the stored transaction type and sign.

Each update plans the removal of the old ledger effects and the addition of the replacement effects.
One commit updates the canonical record, account balances, category funds, payment reserves,
history, indexes, and usage counts. Unchanged memberships retain their counts. Trimmed indexes keep
absent previews absent unless the transaction moves into a new index. Every changed document has a
version precondition. The canonical record uses the snapshot that supplied the original transaction.

Upcoming expenses change `upcomingAmount` without moving account money. A periodless upcoming entry
has no saved period balance to change. A date edit selects the period for its adjusted due date.
Completed entries require a saved destination period. Dry runs include effects in both months and
both account/category assignments.

Financial and schedule edits retain guards against established native allocation effects, splits,
files, reconciliation, and unsupported transaction types. Allocation capability flags alone do not
block an edit. The CLI checks both the original and replacement transaction for native allocation
eligibility, recorded allocation history, and allocation markers. Metadata edits preserve these
fields. Updates preserve recurring clone links without changing the linked occurrence. Updates do
not create or delete recurring records, complete payments, or generate occurrences. Already-created
occurrences require separate edits. For deletion scopes, read
[Recurring Deletion](recurring-deletion.md).

## Recurrence Rules

The saved native artifact establishes these rules:

- Frequency values are `ONE_OFF`, `DAILY`, `WEEKLY`, `FORTNIGHTLY`, `FOUR_WEEKLY`, `MONTHLY`,
  `TWO_MONTHLY`, `QUARTERLY`, `HALF_YEARLY`, `ANNUALLY`, and `BIENNIALLY`.
- Workday policies keep the date, shift to the next workday, or shift to the previous workday. A
  signed `offsetAdjustment` preserves the original scheduled date. DAILY workday repeats shift
  forward. A previous-workday shift that precedes today also shifts forward.
- Workday normalization applies to future incomplete repeats. Monthly intervals preserve a valid
  end-of-month `anchorDay` when the new logical day matches the clipped anchor.
- Frequency changes reset `sequenceCount` to 1 and `repeatCount` to unlimited. Zero or null means
  unlimited. A positive repeat limit is at least `sequenceCount + 1` for an existing record.
- The native interface permits frequency, repeat-limit, and workday-policy edits only for incomplete
  entries. Completed entries retain their recurrence fields.
- `occurrenceChange` contains nullable `amount`, `seriesAmount`, `dueAt`, and `seriesAnchorAt`
  fields. Date fields use Firestore timestamps. `THIS_PAYMENT` retains the prior series baseline for
  an amount/date override. `THIS_AND_LATER` clears the affected override pair.
- `version` describes completion format. It is not an edit revision. Ordinary edits preserve it and
  the integrity count.

The CLI defaults `recurrenceScope` to `THIS_AND_LATER` for upcoming amount/date edits. This explicit
policy prevents stale override fields from silently preserving an obsolete series baseline. Metadata
edits preserve existing overrides. The native save path can preserve overrides when no scope exists.
Supplying the current amount or date with `THIS_AND_LATER` also replaces its future baseline.

Upcoming payments can retain `autoAllocateIfCapable` and `autoAllocateIfIncome` while their amount
or future series baseline changes. An incomplete payment has no completed allocation to reverse. A
completed expense also permits amount edits when its flags do not select a native allocation path.
The CLI preserves the flags for later native completion.

The linked allocation path requires completed, cleared transactions, a stored version, and
`autoAllocateIfCapable`. Its account target must be `GENERIC_ACCOUNT`, with a nonblank category
link. Equal source and destination category links suppress that path. The separate income allocation
path requires completed, cleared income, `autoAllocateIfIncome`, and an extra target. Actual
allocation history or an allocation marker still blocks financial and schedule edits.

The CLI accepts a complete timestamp and preserves its time of day. Calendar calculations use the
stored transaction timezone or an explicitly supplied replacement. Workday shifts preserve local
time across timezone offset changes. Missing or ambiguous local times stop the edit. These are CLI
interface choices: the native picker uses the current system time and its workday normalizer retains
the candidate's fixed offset.

## Evidence And Limits

This change reuses the artifact identity in [Source Reconstruction](source-reconstruction.md). The
evidence comes from static WAT inspection; no live budget mutation established complete native or
backend parity.

| Native Function     | Recovered Contract                                                  |
| ------------------- | ------------------------------------------------------------------- |
| 46954, 47352, 47927 | Frequency, workday policy, and sentiment values                     |
| 48952, 48959        | Canonical transaction and occurrence-override fields                |
| 48966               | Preview fields, including anchor and series baselines               |
| 51690, 51691        | Adjusted due-date month and saved-period lookup                     |
| 51837, 51838        | Monthly anchor preservation and occurrence baseline selection       |
| 51839, 52978, 52979 | Override scope and matching series baseline                         |
| 51845, 51364        | Completion version and update integrity behavior                    |
| 53070, 52969, 78308 | Logical date and workday normalization                              |
| 65206, 78255        | Repeat-limit normalization and frequency reset                      |
| 78318               | Incomplete-only recurrence editing capabilities                     |
| 51847–51849         | Completed linked-allocation eligibility; flags alone have no effect |
| 51742               | Extra-target income allocation requires completion and clearing     |
| 48951, 49253, 50957 | Clone-link copying and projection without related ledger writes     |

Backend recurrence generation, completion, attachments, transfers, and linked allocation reversal
remain outside this writer. [Card Purchases And Refunds](card-transactions.md) records supported
refund effects. Tests verify planned Firestore effects and CLI behavior through controlled document
fixtures.
