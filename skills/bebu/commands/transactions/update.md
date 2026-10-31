# `bebu transactions update`

Edit transaction amounts, details, dates, and upcoming recurrence rules

## Editable fields

Use schema for the complete transactionUpdate payload. amountMinor is a positive integer; the CLI
preserves the purchase, refund, or income sign. Editable fields include accountId, categoryId,
payeeId (null removes it), tagIds ([] removes all), dueAt, timezone, notes, color, cleared,
sentiment, location, and reminder details. Balances, history, indexes, and usage counts change
atomically.

## Recurring payments

Upcoming entries also accept frequency, repeatCount, and nonWorkingDayPolicy. repeatCount is a total
sequence limit; null or zero means unlimited. A positive limit is at least sequenceCount + 1.
Changing frequency resets sequenceCount to 1 and repeatCount to unlimited unless a new limit is
supplied.

For an upcoming recurring amount or date edit, recurrenceScope selects THIS_PAYMENT or
THIS_AND_LATER (default). THIS_PAYMENT preserves the series baseline for later payments.
Resubmitting the current amount or date with THIS_AND_LATER also replaces its future baseline. Only
the selected canonical entry changes; already-created occurrences require separate edits.

dueAt accepts an ISO timestamp with an explicit offset. The CLI keeps its time of day and calculates
dates in the stored transaction timezone, or the supplied timezone. Weekend policies adjust future
dates and retain their original schedule anchors. DAILY workday repeats always shift forward.
Upcoming months without saved periods remain periodless. This command does not complete payments or
generate occurrences.

## Restrictions

Financial and schedule edits support editable, unreconciled expenses, card refunds, and income
without splits, files, or active native allocation effects. Recurring clone links and inactive
allocation flags are preserved. Actual linked-allocation predicates, allocation history, and
autoAllocated extras remain guarded. Account and category links must agree. Expense categories
linked to other accounts require the native app. Foreign-currency ledgers require the app. Completed
entries cannot change recurrence rules or move to future dates. A completed entry needs an existing
destination budget period. Notes, color, sentiment, location, and reminder metadata remain editable
within the record's other restrictions.

Inspect --dry-run before committing. The summary includes old and new accounts, category funds,
monthly obligations, and allocation resources. Add --full for exact writes and version
preconditions.

## Usage

```
bebu transactions update <id> [options]
```

## Arguments

| Argument | Type   | Required | Description                          |
| -------- | ------ | -------- | ------------------------------------ |
| `id`     | string | Yes      | Use an object ID from a list command |

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
