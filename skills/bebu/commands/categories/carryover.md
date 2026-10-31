# `bebu categories carryover`

Audit stored category carryover across saved months without financial writes

## Interpretation

Compare consecutive saved months under each category's explicit current ALL policy. A signed
residual is stored next-month carryover minus prior raw available funds. Discontinuities are
observations; they do not establish an incorrect baseline or authorize repairs. Missing amounts,
unsupported policies, special categories, and calendar gaps remain unknown. No missing financial
amount becomes zero. Historical policy and backend propagation remain unverified, even when
residuals are zero. Reads use one read-only Firestore snapshot.

## Usage

```
bebu categories carryover [options]
```

## Flags

| Flag                        | Type    | Required | Description                                                           |
| --------------------------- | ------- | -------- | --------------------------------------------------------------------- |
| `--budget`                  | string  | No       | Use this budget ID. The default is the selected budget in the session |
| `--category`                | string  | No       | Inspect one category ID                                               |
| `--compact`, `--no-compact` | boolean | No       | Return JSON without indentation                                       |
| `--from-month`              | string  | No       | Start at this saved YYYY-MM month                                     |
| `--full`, `--no-full`       | boolean | No       | Include complete records or full dry-run writes                       |
| `-h`, `--help`              | boolean | No       | Show help                                                             |
| `--through-month`           | string  | No       | End at this saved YYYY-MM month                                       |

## Supported syntax

Use only the arguments, flags, aliases, and defaults in this reference. If a feature is absent,
report that the reference does not document it.

---

Parent: [`bebu categories`](../categories.md)

[Skill overview](../../SKILL.md)
