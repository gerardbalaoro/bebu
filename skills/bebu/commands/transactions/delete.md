# `bebu transactions delete`

Delete one occurrence or a verified recurring chain with atomic ledger reversal

## Deletion scopes

Recurring deletion requires --scope THIS_PAYMENT or --scope THIS_AND_LATER. THIS_PAYMENT deletes the
selected occurrence and preserves already-generated successors. THIS_AND_LATER deletes the selected
occurrence and every validated forward clone-linked occurrence, including completed entries and
upcoming obligations. Earlier occurrences and their nonempty clone links remain unchanged. A one-off
transaction defaults to a single deletion.

Example: bebu transactions delete <id> --scope THIS_AND_LATER --dry-run. Inspect
deletedTransactions, preservedTransactions, account balances, category funds, payment reserves, and
allocation resources. Add --full for exact atomic writes and version preconditions.

Membership follows canonical clonedToTransactionId links. eventId never selects records. Budget
identity, consecutive sequence numbers, increasing dates, frequency, timezone, account/category
targets, payee, notes, type, and subtype must agree at each boundary. A broken link, cycle, branch,
incompatible boundary, missing dependency, or active allocation effect rejects the entire plan.

## Limits and safety

A live recurring tail without a generated successor cannot use THIS_PAYMENT unless its finite repeat
limit is exhausted. The CLI cannot generate a replacement; use THIS_AND_LATER only when you intend
to stop the series. Preserved predecessor clone links may point to a deleted record, matching native
single-record deletion and preserving earlier completion classification. Do not clear these links.

Completed deletions reverse the saved account, spending, reserve, history, index, and counter
effects. Upcoming deletions remove obligations and usage counts; periodless entries remain
periodless. Supported reminder documents and index entries are removed in the same commit. Native
allocation predicates, allocation history, autoAllocated extras, reconciliation, splits, files,
foreign-currency ledgers, and unsupported linked-account flows remain guarded.

The CLI inspects at most 100 linked occurrences and rejects plans beyond its atomic write/size
limits. Reads and predecessor queries use one Firestore snapshot; concurrent changes fail rather
than trigger automatic retries. No event-based sweep, recurrence conversion, zero-amount rewrite, or
synthetic successor occurs. Backend regeneration has not been established by the saved client
artifact.

## Usage

```
bebu transactions delete <id> [options]
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
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                                     |
| `-h`, `--help`              | boolean | No       | Show help                                                                           |
| `--request-id`              | string  | No       | Identify one operation with 20 letters or digits. Reuse only for an identical retry |
| `--scope`                   | string  | No       | Delete THIS_PAYMENT or THIS_AND_LATER; required for recurring entries               |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu transactions`](../transactions.md)

[Skill overview](../../SKILL.md)
