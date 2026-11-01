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
- [`auth`](auth.md) - Sign in through your browser and manage the saved connection
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
