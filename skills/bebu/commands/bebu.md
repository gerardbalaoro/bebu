# `bebu`

A command-line tool for Beyond Budget accounts and transactions.

## Install or run once

Run once: npx --yes github:gerardbalaoro/bebu <command>

Install globally: npm install -g https://github.com/gerardbalaoro/bebu

Install the skill for your agent: npx --yes skills add gerardbalaoro/bebu --skill bebu

## Browser session

Set BEBU_USERNAME and BEBU_PASSWORD in .env beside .env.schema, or export them. Run bebu auth to
open a visible Patchright browser. Both configured credentials are entered and submitted
automatically. Without credentials, sign in manually. bebu detects completion and validates budget
access. Use --headless only when a visible window is not needed.

Run bebu browser to keep a headless managed browser running in the foreground. It prints JSON with a
loopback CDP endpoint. Connect available browser tooling to that endpoint. Use --headed to show its
window, browser status to read its endpoint, and browser stop to close it.

Auth attaches to a running managed browser and closes only its own tab. For visible sign-in, start
bebu browser --headed, or stop a running headless browser before bebu auth. The session import
command can also capture a named agent-browser session.

Auth status reads saved expiry without renewal. Data commands renew expired browser credentials
automatically. Auth logout deletes local credentials and the managed profile; stop bebu browser
first.

BEBU_HOME selects the bebu data folder. Data commands use direct Firestore requests. Credentials are
entered only on the Beyond Budget origin. Keep .env private. CDP grants full browser access and is
bound to loopback.

## Write rules

Before a change:

1. Use schema to find the accepted JSON fields.
2. Use --dry-run to inspect transaction amounts before and after the change. Add --full to inspect
   all writes.

Amounts use integer minor units (PHP centavos). bebu creates one-off or recurring expenses, income,
and card refunds (type REFUND with a positive amountMinor and expense categoryId). Use frequency,
repeatCount, and nonWorkingDayPolicy to create a recurring series. Read transactions create --help
for completion and period rules. Updates also support existing upcoming recurring payments.
Recurring deletion requires an explicit --scope; read transactions delete --help and inspect its dry
run. Transfers, splits, debts, files, reconciliation, and active linked allocation effects require
separate flows. For manual allocations, use allocations set --dry-run followed by allocations apply
with the saved plan and an explicit request ID. Card purchases can overspend a category; the full
purchase amount changes spending and the payment reserve without allocating funds. Refunds reverse
those effects. Historical dates are retained.

Transaction updates accept amounts, accounts, categories, payees, tags, dates, cleared status, and
metadata. Upcoming entries also accept recurrence rules. Read transactions update --help for scope
and restrictions. The --request-id flag identifies the atomic commit and its save marker.

Transaction commands permanently bind request IDs to actor, budget, action, and original input in
local operation records. An existing request only observes; it never resends. Keep BEBU_HOME and its
records. A new operation needs a new request ID. Native save markers do not bind payloads; old or
cross-device requests lack this local recovery guarantee.

## Historical carryover guard

If a transaction changes category availability or allocation resources before a later saved month,
the CLI blocks execution. This includes category-only reassignments, creation, and deletion. A dry
run reports executionSupported:false and summary.downstreamCarryover, with existing carryover
residuals and affected months. It does not predict or write later-period amounts.

Use categories carryover with an explicit budget to inspect stored cross-period residuals in a
read-only snapshot. Historical policies and backend propagation remain unverified, including when
residuals are zero. Future period materialization is outside this check. Preserve unexplained
discontinuities and review their cause before any repair. Metadata-only and obligation-only changes
remain subject to their usual guards.

## Commit recovery

Transaction commands save the original intent, exact compiled body, and outcome under BEBU_HOME
before dispatch. Use transactions operation REQUEST_ID to inspect a local record and transactions
recover REQUEST_ID to observe its marker and up to 50 current document versions. Recovery never
resends, including rejected requests. Marker presence and current values do not establish an unknown
commit outcome. Native error codes and preconditions remain in commitDiagnostic.

After an authoritative rejection, read fresh state and review a new dry run before creating a new
request ID. Preserve the intended transaction identity; for create, inspect the resolved ID and date
in the saved submission rather than generating a replacement blindly. Sending or unknown outcomes
require observation. Missing or corrupt local records and untracked old or cross-device requests
remain unresolved; preserve existing data and do not blindly replay them.

## Subcommands

- [`accounts`](accounts.md) - Read accounts and change their configuration
- [`allocations`](allocations.md) - Plan and save manual allocations, inspect history, or preview
  target funding
- [`auth`](auth.md) - Open the browser, sign in automatically when configured, and save the
  connection
- [`browser`](browser.md) - Run Patchright in the foreground and publish a local CDP endpoint
- [`budget`](budget.md) - Read budget diagnostics
- [`categories`](categories.md) - Read categories and create or change supported ordinary categories
- [`groups`](groups.md) - Read groups and rename supported ordinary groups
- [`payees`](payees.md) - Read payees
- [`schema`](schema.md) - Show JSON schemas for write payloads
- [`session`](session.md) - Import authentication from a signed-in browser
- [`skills`](skills.md) - Generate or install the bebu agent skill
- [`tags`](tags.md) - Read tags
- [`targets`](targets.md) - Inspect, create, edit, or remove supported monthly spending targets
- [`transactions`](transactions.md) - Read history and edit expenses, income, and upcoming recurring
  payments

---

[Skill overview](../SKILL.md)
