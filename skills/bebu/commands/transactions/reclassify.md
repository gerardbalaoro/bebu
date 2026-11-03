# `bebu transactions reclassify`

Move one completed expense to another category while preserving its stored fields

## Category-only workflow

Use explicit --budget, --from-category and --category with --dry-run --full first. This separate
workflow patches only targetTo.id on the canonical transaction. It transfers signed spending,
category usage counts and the existing raw category preview; existing shared previews change only
targetToId. Account money, payment reserve, funding, allocation history, reconciliation, creator,
version, missing fields and other transaction data are never rebuilt. Completed savings/card records
require complete source/destination category caches and explicit safe source spending. A destination
with one excess count is supported only when both counters agree, transaction-bound queries match
every completed preview, and period and history spending are explicit; the existing difference
remains. Purchases must be editable and negative. Posted REFUND records are positive; category
attribution preserves the original editable flag, including false. Complete same-account/date splits
of 2–20 negative expenses without a canonical parent can move one selected child while all siblings
stay unchanged. Stale preview dates are corrected from the unchanged canonical timestamp and listed
in correctedPreviewFields. Existing legacy fields can stay absent or null because the workflow does
not interpret them. Completed recurring occurrences preserve schedule and clone links. Known DEBT
references are validated and retained without debt writes. Locked non-refund records, incomplete or
mixed splits, other extras and explicitly linked destination categories remain unsupported. Missing
category/account link fields remain uninterpreted; explicit conflicts reject. Historical direct
category effects can be saved under this bounded contract; later carryover remains a backend
operation with no terminal completion receipt. propagationVerified:false is intentional. Review all
accounts and later saved periods after each historical operation; do not batch uncertain changes or
claim category-envelope restoration. General update/delete historical and financial guards remain
unchanged. Live requests use one optimistic transaction and permanent payload-bound ownership.
transactions operation/recover observes only; never replay or replace a sending/unknown request.

## Usage

```
bebu transactions reclassify <id> [options]
```

## Arguments

| Argument | Type   | Required | Description                          |
| -------- | ------ | -------- | ------------------------------------ |
| `id`     | string | Yes      | Use an object ID from a list command |

## Flags

| Flag                        | Type    | Required | Description                                                                                |
| --------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------ |
| `--budget`                  | string  | Yes      | Explicit budget ID                                                                         |
| `--category`                | string  | Yes      | Approved destination category ID                                                           |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                                                            |
| `--dry-run`, `--no-dry-run` | boolean | No       | Preview all changes without a commit                                                       |
| `--from-category`           | string  | Yes      | Expected current category ID                                                               |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                                            |
| `-h`, `--help`              | boolean | No       | Show help                                                                                  |
| `--request-id`              | string  | No       | Identify an operation with 20 letters or digits. Inspect existing requests before retrying |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu transactions`](../transactions.md)

[Skill overview](../../SKILL.md)
