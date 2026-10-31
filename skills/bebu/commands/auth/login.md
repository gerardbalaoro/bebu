# `bebu auth login`

Connect through your Chrome session. If necessary, wait for sign-in

## Examples

bebu auth login bebu auth login --fresh bebu auth status

To reuse your Chrome session:

1. Enable chrome://inspect/#remote-debugging.
2. Approve the connection prompt.
3. If the app requires sign-in, sign in.
4. Open your budget.

## Usage

```
bebu auth login [options]
```

## Flags

| Flag                          | Type    | Required | Description                                                     |
| ----------------------------- | ------- | -------- | --------------------------------------------------------------- |
| `--fresh`, `--no-fresh`       | boolean | No       | Use the separate saved browser profile for bebu                 |
| `--headless`, `--no-headless` | boolean | No       | Use the separate saved browser profile without a visible window |
| `-h`, `--help`                | boolean | No       | Show help                                                       |
| `--timeout`                   | number  | No       | Wait 1 to 3600 seconds for sign-in `[default: 300]`             |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu auth`](../auth.md)

[Skill overview](../../SKILL.md)
