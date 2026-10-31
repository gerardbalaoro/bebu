# `bebu transactions list`

Read the complete history, including older records absent from the app cache

## Legacy records and pagination

Legacy records retain absent fields without inferred defaults. diagnostics identifies records and
fields that fail strict write validation. Invalid records appear in invalidRecords with their raw
decoded data. For decoding failures, invalidRecords.fields retains the original Firestore fields and
diagnostics reports decode_error. Inspect both arrays when exporting history. Missing or invalid
allocation and link fields still block writes.

Without --account, follow nextPageToken until null, even when transactions is empty. Malformed
records do not stop pagination. With --account, matched includes malformed records. Account queries
scan at most 10,000 matches, return at most --limit readable transactions, and do not support
pagination. scanLimitReached reports the scan boundary.

## Usage

```
bebu transactions list [options]
```

## Flags

| Flag                        | Type    | Required | Description                                                           |
| --------------------------- | ------- | -------- | --------------------------------------------------------------------- |
| `--account`                 | string  | No       | Filter by the source or destination account ID                        |
| `--budget`                  | string  | No       | Use this budget ID. The default is the selected budget in the session |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                                       |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                       |
| `-h`, `--help`              | boolean | No       | Show help                                                             |
| `--limit`                   | number  | No       | Return 1 to 1000 transactions `[default: 20]`                         |
| `--page-token`              | string  | No       | Use the next page token from a list without an account filter         |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu transactions`](../transactions.md)

[Skill overview](../../SKILL.md)
