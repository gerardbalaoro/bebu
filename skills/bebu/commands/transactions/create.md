# `bebu transactions create`

Create an expense, income, or card refund with all ledger changes and no automatic allocation

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

Historical dueAt timestamps are preserved. The selected month must have a saved budget period;
historical allocation support is not required. History uses the due-date month in the CLI runtime
timezone. Use --dry-run to inspect balances, spending, and reserves; add --full for exact writes.

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
