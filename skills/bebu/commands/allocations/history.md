# `bebu allocations history`

Read native allocation history, optionally with matching transactions

## History scope

Entries retain their raw source, amount fields, map key, and stored ID. Rows use ascending map-key
order. --transactions looks up both candidate IDs in canonical transactions; unmatched entries
remain visible. A history entry does not establish the complete financial effects of its operation.
Reads include document versions but are not one atomic snapshot.

## Usage

```
bebu allocations history [options]
```

## Flags

| Flag                                  | Type    | Required | Description                                                           |
| ------------------------------------- | ------- | -------- | --------------------------------------------------------------------- |
| `--budget`                            | string  | No       | Use this budget ID. The default is the selected budget in the session |
| `--category`                          | string  | No       | Match categoryId or linkedCategoryId                                  |
| `--compact`, `--no-compact`           | boolean | No       | Return JSON without indentation                                       |
| `--full`, `--no-full`                 | boolean | No       | Include complete records or full dry-run writes                       |
| `-h`, `--help`                        | boolean | No       | Show help                                                             |
| `--month`                             | string  | No       | Filter by an existing YYYY-MM budget month                            |
| `--transactions`, `--no-transactions` | boolean | No       | Look up canonical transactions associated by map key or stored ID     |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu allocations`](../allocations.md)

[Skill overview](../../SKILL.md)
