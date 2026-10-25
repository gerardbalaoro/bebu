# `bebu`

A command-line tool for Beyond Budget accounts and transactions.

## Install or run once

Run once: npx --yes github:gerardbalaoro/bebu <command>

Install globally: npm install -g https://github.com/gerardbalaoro/bebu

Install the skill for your agent: npx --yes skills add gerardbalaoro/bebu --skill bebu

## Browser session

Run bebu auth login.

To reuse your Chrome session (Chrome 144+):

1. Enable chrome://inspect/#remote-debugging.
2. Approve the connection prompt.
3. If the app requires sign-in, sign in.
4. Open your budget.

bebu opens a separate app window in your Chrome profile. It closes that window after login. Your
other tabs stay open.

For a separate saved browser profile, use auth login --fresh.

The auth status command shows the connection state. The auth logout command deletes local
credentials and the separate bebu profile. Your Chrome profile stays intact.

Data commands use direct requests to Firestore. The session import and session prepare commands can
reuse an agent browser.

BEBU_HOME selects the bebu data folder. BEBU_BROWSER selects the browser executable for the separate
profile.

## Write rules

Before a change:

1. Use schema to find the accepted JSON fields.
2. Use --dry-run to inspect transaction amounts before and after the change. Add --full to inspect
   all writes.

Amounts use integer minor units (PHP centavos). bebu changes only one-off expenses and income
without reconciliation. Transfers, splits, repeats, refunds, debts, files, and linked transactions
require separate flows. For manual allocations, use allocations set --dry-run followed by
allocations apply with the saved plan and an explicit request ID. A completed card expense requires
a category with enough funds.

Transaction metadata changes accept notes, color, and cleared. The --request-id flag identifies the
atomic commit and its save marker.

For an identical retry, reuse --request-id and the original payload. For a different operation, use
a new request ID. Save markers do not bind the ID to a payload. An alreadyCommitted result proves
marker existence only. Marker expiry and validation before the commit also limit retries.

## Subcommands

- [`accounts`](accounts.md) - Read accounts and change their configuration
- [`allocations`](allocations.md) - Plan and save manual allocations, inspect history, or preview
  target funding
- [`auth`](auth.md) - Sign in through your browser and manage the saved connection
- [`budget`](budget.md) - Read budget diagnostics
- [`categories`](categories.md) - Read expense and payment categories
- [`payees`](payees.md) - Read payees
- [`schema`](schema.md) - Show JSON schemas for write payloads
- [`session`](session.md) - Import authentication from a signed-in browser
- [`skills`](skills.md) - Generate or install the bebu agent skill
- [`tags`](tags.md) - Read tags
- [`targets`](targets.md) - Inspect stored category targets
- [`transactions`](transactions.md) - Read history and write one-off expenses or income

---

[Skill overview](../SKILL.md)
