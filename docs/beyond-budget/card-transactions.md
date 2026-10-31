# Credit Card Purchases And Refunds

This report records the native client ledger contract used for card purchases and expense-category
refunds. It supports changes to the CLI's funding and refund guards. The evidence is static; no
budget was changed.

## Evidence Identity

The saved public web build and indexed WAT were reused. Both hashes matched during this
investigation:

- Module: `4ef2928daa118d1b3431.wasm`, 33,069,046 bytes.
- Module SHA-256: `1c9b9bb1e7699c7080cba0095485e04772285c200ab458f57346161d233a9eea`.
- Decoded WAT SHA-256: `dfa66d5044ec6cc1a31f53c6437d325d34d2190fc475f2894c899c474f7c6c9c`.

Function and struct numbers below refer to that module. No new REA evidence IDs were produced. Prior
provider and decoder limitations are recorded in [Linked Income Allocation](linked-allocation.md).

## Canonical Refund Representation

The refund screen saves an expense-category refund through `58228 → 58167 → 50899 → 50903`. The
selected account remains the source, and the expense category remains the destination. The resulting
transaction has type `OUTFLOW`, subtype `REFUND`, and a positive stored amount.

The native refund picker also supports subtype `CREDIT`. Function 47433 maps its two choices to
`49018` and `49019`. Function 49013 recognizes both subtypes. Function 50903 preserves their
positive amounts and negates ordinary expense input amounts. A refund is therefore a signed reversal
within the expense flow, rather than income directed to a card account.

The screen has a separate confirmation path when the selected category is an income category. That
path and general card income are outside this expense-category contract.

## Ledger Effects

The following table applies to completed transactions with a card source and an ordinary expense
category. Let `s` be the signed stored amount: a purchase stores a negative value; a refund stores a
positive value.

| Field                                 | Cleared Change | Uncleared Change |
| ------------------------------------- | -------------- | ---------------- |
| Card `balanceAmount`                  | `+s`           | None             |
| Card `unclearedBalanceAmount`         | None           | `+s`             |
| Card `historicalBalances`             | `+s`           | None             |
| Expense category `spentAmount`        | `-s`           | `-s`             |
| Expense category `historicalSpending` | `-s`           | `-s`             |
| Card payment category `otherAmount`   | `-s`           | `-s`             |
| Payee/tag `historicalBalances`        | `+s`           | None             |
| Payee/tag `historicalSpending`        | `abs(s)`       | `abs(s)`         |

Function 51752 dispatches the outflow effects. Function 51758 changes the expense category and
linked payment category. Function 51729 changes exactly one account balance field. Function 51731
changes account history only when the transaction is completed and cleared.

Category spending history uses `51716 → 51733`, with the absolute-value option disabled for CREDIT
and REFUND. Payee and tag history uses `51719/51720 → 51721`. That path always enables the
absolute-value option for spending history. This makes refund payee/tag spending history positive,
even though category spending history decreases. Balance history retains the signed amount.

The same cleared-versus-uncleared account rules apply to ordinary generic-account expenses. They do
not have the card payment-category movement.

For incomplete transactions, 51758 changes expense-category `upcomingAmount` by `-s`. It does not
change the card balance, payment reserve, or historical amounts.

## Unfunded Purchases

Function 51758 increments the payment category's raw `otherAmount` by the full purchase amount. It
does not read category availability, clamp the movement to available funds, or reject overspending.
The expense category's `spentAmount` also increases by the full amount. Its available funds can
become negative.

For example, a purchase of 1,000 minor units increases both spending and the payment reserve by
1,000. Starting expense-category funds of zero or 400 become -1,000 or -600, respectively. The
inspected write path does not create category allocations to cover either shortfall.

These are raw persisted ledger effects. The reserve increment does not establish that the budget has
enough cash to pay the card. Funding limits must not be inferred from that increment.

## History And Indexes

Shared history helper 51717 derives its month from the transaction's original `dueAt` through
`53509 → 17482`, using the runtime system timezone. It does not replace historical dates with today.
These direct history increments do not require reconstruction of historical category allocations.

The outflow handler also maintains account, expense-category, period, general transaction, payee,
and tag previews through 51713/51714. Category and account counters use 51757 and 51729. The linked
payment category receives its reserve movement without becoming the expense destination. The
ordinary card purchase/refund path does not add a separate payment-category transaction preview.

Create, delete, and update share the same effect handler. Update removes the stored effects before
adding replacement effects (`51724`). Removal negates each increment through the operation mapper
`51728`; addition preserves it through 14314.

## Boundaries

The inspected case has one account and expense category, one matching currency, and a valid linked
payment category. It excludes split transactions, foreign currency, loan accounts, and
category-account links that cause additional linked-account effects.

These findings establish client instructions, not observed server execution. They do not establish
preview eviction behavior, backend triggers, carryover propagation, or the separate refund-as-income
flow. The card expense handler itself contains no allocation write or separate CREDIT_OR_REFUND
allocation-history save.
