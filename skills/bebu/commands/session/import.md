# `bebu session import`

Import one session source. Playwright state must include IndexedDB

## Usage

```
bebu session import [options]
```

## Flags

| Flag                        | Type    | Required | Description                                               |
| --------------------------- | ------- | -------- | --------------------------------------------------------- |
| `--agent-browser`           | string  | No       | Use this named agent-browser session with an active login |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                           |
| `-h`, `--help`              | boolean | No       | Show help                                                 |
| `--playwright-state`        | string  | No       | Read Playwright storageState JSON that includes IndexedDB |
| `--sealed`                  | string  | No       | Read the encrypted handoff from this JSON file            |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu session`](../session.md)

[Skill overview](../../SKILL.md)
