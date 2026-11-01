# `bebu categories move`

Append one ordinary category to a later group

## Bounded append move

Review --dry-run --full with explicit --budget, --from-group and --group. The source must be an
active modifiable DEFAULT category without a parent, children, target or stored account links. Both
groups must be active modifiable DEFAULT groups with explicit native integer orders. The destination
must follow the source group and be nonempty and flat. Affected peers need explicit unique
nonnegative native integer orders. Every account must have a matching identity and an explicit
category link field excluding the source. Missing account-link evidence rejects execution. The
command patches only groupId/order, appending after the highest destination order. Other settings,
absent fields, transaction identities and amounts remain unchanged. Grouped reports and future
funding behavior can change. Live requests bind a permanent local request ID to their intent and
exact body; only a complete original acknowledgment establishes success. Unknown/sending outcomes
must never be replayed or replaced. Inspect with transactions operation/recover and retain
BEBU_HOME. Reverse moves, subtrees, linked/targeted sources, empty destinations, and peer
normalization remain unsupported.

## Usage

```
bebu categories move <id> [options]
```

## Arguments

| Argument | Type   | Required | Description |
| -------- | ------ | -------- | ----------- |
| `id`     | string | Yes      | Category ID |

## Flags

| Flag                        | Type    | Required | Description                                                                                |
| --------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------ |
| `--budget`                  | string  | Yes      | Explicit budget ID                                                                         |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                                                            |
| `--dry-run`, `--no-dry-run` | boolean | No       | Preview all changes without a commit                                                       |
| `--from-group`              | string  | Yes      | Expected current group ID                                                                  |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                                            |
| `--group`                   | string  | Yes      | Destination group ID                                                                       |
| `-h`, `--help`              | boolean | No       | Show help                                                                                  |
| `--request-id`              | string  | No       | Identify an operation with 20 letters or digits. Inspect existing requests before retrying |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu categories`](../categories.md)

[Skill overview](../../SKILL.md)
