# Recurring Transaction Creation

Use `transactions create` with `frequency` to save an initial recurring expense, income, or card
refund. The [create reference](../../skills/bebu/commands/transactions/create.md) lists accepted
values and restrictions. Preview the entry before committing:

```json
{
  "accountId": "cashId",
  "categoryId": "subscriptionId",
  "amountMinor": 15000,
  "dueAt": "2030-01-31T09:00:00+08:00",
  "timezone": "Asia/Manila",
  "frequency": "MONTHLY",
  "repeatCount": 12,
  "nonWorkingDayPolicy": "KEEP_ORIGINAL_DATE"
}
```

```sh
bebu transactions create --file transaction.json --dry-run --full
```

## Initial State And Effects

A new series starts at `sequenceCount: 1`. `repeatCount` includes that initial payment; omitted,
null, or zero means unlimited. Unlike an existing-entry edit, creation permits a limit of one.

An ongoing series starts incomplete, including entries due today or earlier. Omit `completed` or
supply false. A single-payment repeat already due is completed; a future single-payment repeat
remains upcoming. An explicit contradictory completion state stops creation. The CLI determines
whether that single payment is due from its timestamp, consistent with existing CLI creation.

Future workday shifts use the transaction timezone and retain local time. The saved offset and
monthly anchor describe the original schedule. DAILY workday repeats shift forward. Missing or
ambiguous adjusted local times stop creation. These timezone choices match the CLI's
[editing contract](transaction-editing.md); they do not establish native picker parity.

The adjusted due date selects `yearMonth` and an optional saved `periodId`. Upcoming recurring
entries can be periodless. Completed entries require a saved period. Creation never creates a
missing period.

Creation commits one canonical entry, index previews, and usage counters together. Upcoming expenses
change only their saved period's obligations. They do not change account balances, spending, payment
reserves, or financial history. A periodless entry has no saved obligations to change. Completed
single-payment repeats use the existing signed ledger, including card refunds. Automatic allocation
remains disabled. Unsupported account links, categories, and foreign currencies retain their
existing guards.

Creation does not generate successors or complete an ongoing payment. Use the native app for those
steps. The saved client artifact does not establish backend occurrence-generation behavior.

## Native Evidence

This investigation reused the exact saved module and WAT identified in
[Recurring Deletion](recurring-deletion.md#evidence-identity). Evidence comes from static WAT,
without live budget access or mutation. REA's WASM provider still required an unset
`REA_WABT_BIN_DIRECTORY`; the existing decoded artifact supplied the instructions.

| Native Function | Recovered Contract                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `50903 → 45770` | Expense creation constructs an entry with null event, clone, repeat, sequence, version, and anchor fields.                                 |
| `45561`         | Enabled recurrence supplies frequency, repeat limit, workday policy, offset, and initial sequence one.                                     |
| `50916 → 51690` | Repository creation normalizes the initial canonical entry before saving its shared ledger effects.                                        |
| `45777`         | A recurring entry without a clone remains incomplete unless its finite repeat limit equals its sequence. Future entries remain incomplete. |
| `51691`         | The normalized due-date month selects a nullable existing period; this path does not create a period.                                      |
| `51837`         | Incomplete monthly schedules derive their anchor from the logical date. Completed entries retain their anchor.                             |
| `51845`         | Effective completion sets version one; upcoming creation retains null.                                                                     |

Native completion compares calendar dates in the system clock context. The CLI uses an instant
boundary for single-payment repeats, so a payment later today can remain upcoming. Native period
lookup uses the runtime system timezone; the CLI selects the month in the transaction timezone.
These interface differences do not change ongoing recurrences' incomplete state.

The CLI preserves null event and clone fields and adds no speculative generation writes. Shared
schedule calculations retain the evidence and limitations described in
[Transaction Editing](transaction-editing.md#evidence-and-limits).

Behavioral tests cover every repeat frequency, finite and unlimited limits, month-boundary shifts,
periodless starts, obligations, indexes, counters, completion boundaries, signed refunds, and a
single atomic commit. They also exercise recurrence JSON through the CLI and verify that dry runs
send no writes. These fixtures verify the CLI contract without claiming observed backend parity.
