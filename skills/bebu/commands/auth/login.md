# `bebu auth login`

Sign in with configured credentials through Patchright

## Examples

Set BEBU_USERNAME and BEBU_PASSWORD in .env beside .env.schema, or export them.

bebu auth bebu auth login bebu auth status

The browser is visible by default. Both configured credentials are entered automatically. Otherwise,
complete sign-in manually. bebu detects completion and validates budget access.

## Usage

```
bebu auth login [options]
```

## Flags

| Flag                          | Type    | Required | Description                                                            |
| ----------------------------- | ------- | -------- | ---------------------------------------------------------------------- |
| `--force`, `--no-force`       | boolean | No       | Recover a stale profile lock after its login process has exited        |
| `--fresh`, `--no-fresh`       | boolean | No       | Launch the saved profile directly; requires bebu browser to be stopped |
| `--headed`, `--no-headed`     | boolean | No       | Show the browser for manual sign-in or challenges                      |
| `--headless`, `--no-headless` | boolean | No       | Run without a visible window                                           |
| `-h`, `--help`                | boolean | No       | Show help                                                              |
| `--timeout`                   | number  | No       | Wait 1 to 3600 seconds for sign-in `[default: 300]`                    |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu auth`](../auth.md)

[Skill overview](../../SKILL.md)
