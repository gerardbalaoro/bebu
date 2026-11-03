# `bebu auth`

Open the browser, sign in automatically when configured, and save the connection

## Usage

```
bebu auth [options]
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

Parent: [`bebu`](bebu.md)

[Skill overview](../SKILL.md)
