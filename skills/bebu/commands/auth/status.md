# `bebu auth status`

Show saved connection and browser profile state as JSON

## Profile recovery

The profile path follows the current BEBU_HOME or BEBU_SESSION_FILE. An owned profile can be
reopened with auth login --fresh; sign in if prompted. A lock means a browser operation may be
active, not that it is safe to delete the lock. If the previous process crashed, verify that no bebu
browser operation is running before removing the reported profile path with .lock appended. An
unrecognized profile is never adopted or deleted.

## Usage

```
bebu auth status [options]
```

## Flags

| Flag           | Type    | Required | Description |
| -------------- | ------- | -------- | ----------- |
| `-h`, `--help` | boolean | No       | Show help   |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu auth`](../auth.md)

[Skill overview](../../SKILL.md)
