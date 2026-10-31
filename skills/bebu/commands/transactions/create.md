# `bebu transactions create`

Create one-off or recurring expenses, income, and card refunds without automatic allocation

## Recurring transactions

Supply frequency, optional repeatCount, and optional nonWorkingDayPolicy in the create JSON.
frequency defaults to ONE_OFF. Supported repeats are DAILY, WEEKLY, FORTNIGHTLY, FOUR_WEEKLY,
MONTHLY, TWO_MONTHLY, QUARTERLY, HALF_YEARLY, ANNUALLY, and BIENNIALLY. Workday policies are
KEEP_ORIGINAL_DATE (default), SHIFT_TO_NEXT_AVAILABLE_WORKDAY, and
SHIFT_TO_PREVIOUS_AVAILABLE_WORKDAY. For example:
{"accountId":"cashId","categoryId":"subscriptionId","amountMinor":15000,"dueAt":"2030-01-31T09:00:00+08:00","timezone":"Asia/Manila","frequency":"MONTHLY","repeatCount":12}.
Preview with transactions create --file transaction.json --dry-run; add --full for exact writes.

A new series starts at sequenceCount 1. repeatCount is the total number of payments; omitted, null,
or zero means unlimited. A limit of 1 is valid on creation. Ongoing series start incomplete, even
when due today or earlier. Omit completed or supply false. A single-payment repeat already due is
completed; future single-payment repeats remain upcoming. The CLI uses the due timestamp to
determine whether that single payment is due.

Future workday shifts preserve local time, the original date offset, and monthly anchors. DAILY
workday repeats shift forward. The adjusted due date selects its saved period. Upcoming entries can
be periodless; completed entries require an existing period. Upcoming expenses affect only
obligations, indexes, and usage counts. No completed balance, spending, payment-reserve, history, or
allocation effects occur until completion.

Creation saves one initial canonical entry and its indexes atomically. It does not generate later
occurrences or complete an ongoing payment. Use the native app for completion and occurrence
generation. One-off entries cannot have a finite repeat limit or a workday-shift policy. Automatic
allocation remains disabled.

## Card purchases and refunds

Use type OUTFLOW for a purchase or REFUND for a credit-card refund. amountMinor is always positive.
A refund requires accountId for the card and categoryId for an ordinary expense category. For
example:
{"type":"REFUND","accountId":"cardId","categoryId":"groceriesId","amountMinor":12500,"dueAt":"2026-10-01T12:00:00+08:00"}.
The stored refund is a positive OUTFLOW with subtype REFUND. Expense categories linked to other
accounts require the native app.

Card purchases can overspend a category. Both spending and the linked payment category reserve
change by the full purchase amount; refunds reverse those movements. This does not allocate cash to
cover overspending. An uncleared entry changes only the uncleared account balance; clearing moves it
into the cleared balance and account history. Expense-category spending changes regardless of
clearing.

Historical dueAt timestamps are preserved. Completed entries and one-off creation require a saved
budget period; historical allocation support is not required. History uses the due-date month in the
CLI runtime timezone. Use --dry-run to inspect balances, spending, and reserves; add --full for
exact writes.

## Usage

```
bebu transactions create [options]
```

## Flags

| Flag                        | Type    | Required | Description                                                                         |
| --------------------------- | ------- | -------- | ----------------------------------------------------------------------------------- |
| `--budget`                  | string  | No       | Use this budget ID. The default is the selected budget in the session               |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                                                     |
| `--dry-run`, `--no-dry-run` | boolean | No       | Preview all changes without a commit                                                |
| `--file`                    | string  | Yes      | Read the JSON payload from this file. Use - for stdin                               |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                                     |
| `-h`, `--help`              | boolean | No       | Show help                                                                           |
| `--request-id`              | string  | No       | Identify one operation with 20 letters or digits. Reuse only for an identical retry |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu transactions`](../transactions.md)

[Skill overview](../../SKILL.md)
