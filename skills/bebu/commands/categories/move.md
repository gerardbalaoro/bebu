# `bebu categories move`

Preview appending one ordinary category to another group

## Preview only

Requires --dry-run and explicit --budget, --from-group and --group. The source must be an active
modifiable DEFAULT category without a parent, children, target or stored account links. Both groups
must be active modifiable DEFAULT groups with explicit native integer orders. The destination must
follow the source group and be nonempty and flat. Affected peers need explicit unique nonnegative
native integer orders. The preview appends after the highest destination order and proposes only
groupId/order patches, preserving other fields. No financial amounts or missing settings receive
defaults. executionSupported is false. Native append-move evidence and deployed CLI lab validation
remain required before a live writer is enabled. This command cannot execute a move, create an
operation record, or bypass transaction guards.

## Usage

```
bebu categories move <id> [options]
```

## Arguments

| Argument | Type   | Required | Description |
| -------- | ------ | -------- | ----------- |
| `id`     | string | Yes      | Category ID |

## Flags

| Flag                        | Type    | Required | Description                                     |
| --------------------------- | ------- | -------- | ----------------------------------------------- |
| `--budget`                  | string  | Yes      | Explicit budget ID                              |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                 |
| `--dry-run`, `--no-dry-run` | boolean | No       | Preview all changes without a commit            |
| `--from-group`              | string  | Yes      | Expected current group ID                       |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes |
| `--group`                   | string  | Yes      | Destination group ID                            |
| `-h`, `--help`              | boolean | No       | Show help                                       |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu categories`](../categories.md)

[Skill overview](../../SKILL.md)
