# `bebu allocations apply`

Apply one reviewed manual allocation plan atomically

## Execution and recovery

Requires a plan saved by allocations set and a new explicit request ID. The command rereads every
dependency inside an optimistic transaction and rejects stale or edited plans. It writes the
selected period, category history, budget MANUAL history, and native marker atomically. Account
money and links are preserved.

The request is permanently claimed in BEBU_HOME before sending. Reuse the exact plan and request ID
to inspect an identical operation; changed content is rejected. Unknown outcomes are never
automatically resent. Use allocations recover with the original request ID and budget. Recovery
depends on the trusted local record and native marker; cross-device or permanent remote payload
binding is not provided.

Committed and synchronization-pending are separate results. Delayed carryover never causes another
financial submission. Keep the local operation directory. This command does not implement undo,
reallocation, automatic income allocation, or bulk overspending coverage.

## Usage

```
bebu allocations apply [options]
```

## Flags

| Flag                        | Type    | Required | Description                                         |
| --------------------------- | ------- | -------- | --------------------------------------------------- |
| `--budget`                  | string  | No       | Use this budget ID                                  |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                     |
| `-h`, `--help`              | boolean | No       | Show help                                           |
| `--plan`                    | string  | Yes      | Read the reviewed plan from this file               |
| `--request-id`              | string  | Yes      | Permanently bind this new 20-character operation ID |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu allocations`](../allocations.md)

[Skill overview](../../SKILL.md)
