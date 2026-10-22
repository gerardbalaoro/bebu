---
name: bebu
description:
  "Use for Beyond Budget sign-in, account balances, category funds, allocation diagnostics, history
  queries, account configuration, and transaction changes."
metadata:
  version: "0.1.0"
---

# bebu

Before you use the app, read [the login and write rules](commands/bebu.md).

## Run commands

If bebu is installed, use the command signatures as written. Otherwise, replace the initial bebu
with npx --yes github:gerardbalaoro/bebu. A global CLI installation is not required.

## Choose a command

1. Find the command for the task in the command reference.
2. Read the Type column. Only runnable commands accept direct execution. A group without an action
   contains other commands.
3. Before you use or explain a command, read its linked reference.
4. Use only the arguments, flags, aliases, and defaults in that reference.
5. If a feature is absent, report that the reference does not document it.

## Money and category funds

Account balances describe money or debt in accounts. Category funds describe budget assignments for
a specific month. For category funds, use categories funding with an explicit month. Keep
otherAmount and carryover in the available amount. Upcoming obligations are separate from available
funds. This query does not calculate ready-to-allocate funds or parent totals.

For account/category links or allocation settings, use budget diagnostics. Report the returned
values with their document paths. Unknown values and absent settings have no inferred meaning or
default.

## Allocation requests

For a target funding preview, use allocations preview with an explicit month. The CLI calculates
eligibility, priority, requested amounts, partial funding, and shortfalls from saved data. It
supports a limited set of ordinary zero-based budgets and target types. An unsupported input stops
the preview. Do not calculate missing amounts or reproduce a rejected workflow with a chain of
commands. The preview reports executionSupported:false and cannot save allocations.

For allocation records, use allocations history. For category and nature totals, use allocations
report. For positive historical averages, use allocations averages with an explicit reference month.
For raw target settings, use targets list. Category availability is not target progress.

For allocation writes, overspending coverage, or allocation undo, use the native Beyond Budget app.
CLI income does not fund categories. Cleared, completed income increases allocation resources in a
zero-based budget. Native income allocation, linked-account allocation, and bulk allocation are
separate workflows. Their availability depends on the native app and its settings.

A completed CLI card expense needs sufficient category funds and increases the linked payment
category's otherAmount. This payment reserve effect does not enable automatic allocation.

## Preview and retry

Before a transaction change, inspect --dry-run. The summary shows metadata, account balances,
category funds, and allocation resources before and after. The summary explicitly reports
automaticAllocation:false. Add --full to inspect the Firestore writes and preconditions. A preview
describes the current snapshots. A later command reads fresh snapshots and can produce different
results.

Transactions with confirmed or possible native allocation effects reject deletion and clearing
changes. Notes and color remain editable within the command's other restrictions. Do not remove
allocation flags or history to bypass a rejection.

For an identical retry, reuse the request ID and original payload. For a different operation, use a
new request ID. For create retries, preserve the resolved id, dueAt, timezone, completed, and
cleared fields.

Save markers do not bind request IDs to payloads. An alreadyCommitted result proves marker existence
only. A retry can fail before marker lookup, including after deletion. After marker expiry,
duplicate detection is not guaranteed.

## Command reference

| Command                     | Type     | Description                                                                                            | Documentation                                                        |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `bebu`                      | group    | A command-line tool for Beyond Budget accounts and transactions.                                       | [commands/bebu.md](commands/bebu.md)                                 |
| `bebu accounts`             | group    | Read accounts and change their configuration                                                           | [commands/accounts.md](commands/accounts.md)                         |
| `bebu accounts list`        | runnable | List account IDs and balances in integer minor units                                                   | [commands/accounts/list.md](commands/accounts/list.md)               |
| `bebu accounts show`        | runnable | Read a complete account record                                                                         | [commands/accounts/show.md](commands/accounts/show.md)               |
| `bebu accounts update`      | runnable | Change the account configuration. Use schema for the accepted JSON fields                              | [commands/accounts/update.md](commands/accounts/update.md)           |
| `bebu allocations`          | group    | Preview target allocation and inspect category allocation history                                      | [commands/allocations.md](commands/allocations.md)                   |
| `bebu allocations averages` | runnable | Read average allocation and spending from prior saved months                                           | [commands/allocations/averages.md](commands/allocations/averages.md) |
| `bebu allocations history`  | runnable | Read native allocation history, optionally with matching transactions                                  | [commands/allocations/history.md](commands/allocations/history.md)   |
| `bebu allocations preview`  | runnable | Calculate target funding without changing the budget                                                   | [commands/allocations/preview.md](commands/allocations/preview.md)   |
| `bebu allocations report`   | runnable | Summarize monthly allocations by category and nature                                                   | [commands/allocations/report.md](commands/allocations/report.md)     |
| `bebu auth`                 | group    | Sign in through your browser and manage the saved connection                                           | [commands/auth.md](commands/auth.md)                                 |
| `bebu auth login`           | runnable | Connect through your Chrome session. If necessary, wait for sign-in                                    | [commands/auth/login.md](commands/auth/login.md)                     |
| `bebu auth logout`          | runnable | Delete local credentials and the separate bebu profile. Your Chrome profile stays intact               | [commands/auth/logout.md](commands/auth/logout.md)                   |
| `bebu auth status`          | runnable | Show saved connection state as JSON                                                                    | [commands/auth/status.md](commands/auth/status.md)                   |
| `bebu budget`               | group    | Read budget diagnostics                                                                                | [commands/budget.md](commands/budget.md)                             |
| `bebu budget diagnostics`   | runnable | Read stored account/category links and allocation settings with their source paths                     | [commands/budget/diagnostics.md](commands/budget/diagnostics.md)     |
| `bebu categories`           | group    | Read expense and payment categories                                                                    | [commands/categories.md](commands/categories.md)                     |
| `bebu categories funding`   | runnable | Read category funds for one month in integer minor units                                               | [commands/categories/funding.md](commands/categories/funding.md)     |
| `bebu categories list`      | runnable | List category IDs and types                                                                            | [commands/categories/list.md](commands/categories/list.md)           |
| `bebu payees`               | group    | Read payees                                                                                            | [commands/payees.md](commands/payees.md)                             |
| `bebu payees list`          | runnable | List IDs and usage counts for payees                                                                   | [commands/payees/list.md](commands/payees/list.md)                   |
| `bebu schema`               | runnable | Show JSON schemas for write payloads                                                                   | [commands/schema.md](commands/schema.md)                             |
| `bebu session`              | group    | Import authentication from a signed-in browser                                                         | [commands/session.md](commands/session.md)                           |
| `bebu session import`       | runnable | Import one session source. Playwright state must include IndexedDB                                     | [commands/session/import.md](commands/session/import.md)             |
| `bebu session prepare`      | runnable | Prepare an encrypted session handoff without credentials in the output                                 | [commands/session/prepare.md](commands/session/prepare.md)           |
| `bebu session status`       | runnable | Show session expiry and budget IDs without credentials                                                 | [commands/session/status.md](commands/session/status.md)             |
| `bebu skills`               | group    | Generate or install the bebu agent skill                                                               | [commands/skills.md](commands/skills.md)                             |
| `bebu skills generate`      | runnable | Generate the bebu skill and command reference                                                          | [commands/skills/generate.md](commands/skills/generate.md)           |
| `bebu skills install`       | runnable | Generate and copy the bebu skill into .agents/skills in this project                                   | [commands/skills/install.md](commands/skills/install.md)             |
| `bebu tags`                 | group    | Read tags                                                                                              | [commands/tags.md](commands/tags.md)                                 |
| `bebu tags list`            | runnable | List IDs and usage counts for tags                                                                     | [commands/tags/list.md](commands/tags/list.md)                       |
| `bebu targets`              | group    | Inspect stored category targets                                                                        | [commands/targets.md](commands/targets.md)                           |
| `bebu targets list`         | runnable | Read target settings separately from category funds                                                    | [commands/targets/list.md](commands/targets/list.md)                 |
| `bebu transactions`         | group    | Read history and write one-off expenses or income                                                      | [commands/transactions.md](commands/transactions.md)                 |
| `bebu transactions create`  | runnable | Create an expense or income with all ledger changes. The command does not allocate funds automatically | [commands/transactions/create.md](commands/transactions/create.md)   |
| `bebu transactions delete`  | runnable | Delete a supported transaction and reverse its ledger effects atomically                               | [commands/transactions/delete.md](commands/transactions/delete.md)   |
| `bebu transactions list`    | runnable | Read the complete history, including older records absent from the app cache                           | [commands/transactions/list.md](commands/transactions/list.md)       |
| `bebu transactions show`    | runnable | Read a complete transaction record                                                                     | [commands/transactions/show.md](commands/transactions/show.md)       |
| `bebu transactions update`  | runnable | Change notes, color, or cleared status in the record and its indexes                                   | [commands/transactions/update.md](commands/transactions/update.md)   |
