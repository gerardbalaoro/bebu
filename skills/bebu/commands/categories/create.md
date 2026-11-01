# `bebu categories create`

Create one ordinary category and its empty stash atomically

## Supported subset

Requires an explicit budget, name, group, icon and color. Choose icon/color codes from categories
list --full. Only ordinary zero-based budgets without a challenge and active modifiable DEFAULT
groups are supported. The nonempty selected group must be flat, with explicit unique safe peer
orders. The command appends after the highest order and rejects duplicate names. It creates the
native DEFAULT/ALL/UNCATEGORIZED category with no account links, target or parent, plus an empty
CATEGORY stash. Existing financial records are untouched; no missing financial amounts are assigned.
Review --dry-run --full. Live execution reads fresh state and binds the exact generated identity and
commit body to permanent operation records. Use transactions operation/recover with the original
request ID after uncertainty; never replay or replace it. Group creation, empty groups, other
policies, hierarchy, funding and historical transaction edits remain unsupported. Native creation
evidence and deployed disposable-lab CLI saves establish this subset. The original complete
acknowledgment and full document comparisons confirm the creation envelope and preservation of
existing records.

## Usage

```
bebu categories create [options]
```

## Flags

| Flag                        | Type    | Required | Description                                                                                |
| --------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------ |
| `--budget`                  | string  | Yes      | Explicit budget ID                                                                         |
| `--color`                   | string  | Yes      | Color code from an existing category                                                       |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                                                            |
| `--dry-run`, `--no-dry-run` | boolean | No       | Preview all changes without a commit                                                       |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                                            |
| `--group`                   | string  | Yes      | Existing ordinary group ID                                                                 |
| `-h`, `--help`              | boolean | No       | Show help                                                                                  |
| `--icon`                    | string  | Yes      | Icon code from an existing category                                                        |
| `--name`                    | string  | Yes      | New category name                                                                          |
| `--request-id`              | string  | No       | Identify an operation with 20 letters or digits. Inspect existing requests before retrying |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu categories`](../categories.md)

[Skill overview](../../SKILL.md)
