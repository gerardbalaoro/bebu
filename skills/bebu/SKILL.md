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

For stored cross-period carryover, use categories carryover with an explicit budget and optional
saved-month range. The read-only snapshot reports raw residuals under explicit current ALL policies,
with document versions. Missing amounts, special categories, unsupported policies, and calendar gaps
remain unknown without financial defaults. A discontinuity does not establish an incorrect baseline.
Zero residuals do not verify historical policy or propagation.

For account/category links or allocation settings, use budget diagnostics. Report the returned
values with their document paths. Unknown values and absent settings have no inferred meaning or
default.

## Category and group names

Use categories rename ID --name NAME or groups rename ID --name NAME with an explicit budget and
--dry-run. Use groups list to find group IDs. Add --full to inspect the exact name-only patch. The
supported subset is active DEFAULT records with explicit modifiable:true and matching identities.
Names use a CLI limit of 1–200 trimmed characters. A rename preserves financial, hierarchy, target,
and unknown fields. After an uncertain rename outcome, inspect the current name before another
command. For a bounded hierarchy change, use categories attach ID --parent PARENT_ID or categories
detach ID --parent EXPECTED_PARENT_ID. Use an explicit budget and review --dry-run --full first.
Parent intent is required for both commands. Only active modifiable DEFAULT categories and groups,
within one group and one level, are supported. The source cannot have children. Every member of the
affected parent family must lack target, aggregation, accumulation, and computation settings. Stored
link lists must be absent or empty. The complete account index must provide explicit link fields and
exclude family links. Absent category link lists remain absent; no financial defaults or link
repairs are assigned. Explicit safe orders must remain unambiguous. Attach writes the parent and
group fields; detach deletes the parent field. These operations preserve stored amounts and order
but change parent coverage membership. Future funding outcomes are not predicted. They do not repair
carryover or enable historical transaction edits. Inspect categories list --full after an uncertain
outcome. Marker-only confirmation cannot prove the requested hierarchy change. Do not blindly retry.
Cross-group moves, targeted or linked families, deeper trees, creation, archive, and reordering
remain unsupported.

## Transaction history

Legacy transaction reads preserve absent fields without defaults. Inspect diagnostics and
invalidRecords as well as transactions. diagnostics identifies strict write-validation failures.
invalidRecords retains raw decoded records with invalid field types. For decoding failures,
invalidRecords.fields preserves the original Firestore fields and diagnostics reports decode_error.
Without an account filter, follow nextPageToken until null, even when transactions is empty.
Account-filtered queries have no pagination. matched includes malformed records; scanLimitReached
reports the 10,000-record scan boundary. Missing allocation or link fields remain unknown and block
writes through strict validation. transactions show also preserves absent legacy fields and explicit
null creators without adding write defaults. Explicit createdBy:null is native-supported and remains
null in canonical records and creator IDs in new index previews. Absent creator, allocation,
link-type, and version fields still fail strict write validation. A narrow legacy card
representation permits explicit null link type and version only with matching saved/current
payment-category links. This preserves saved targets and does not repair links. All other
allocation, split, editability, and historical funding guards remain.

## Allocation requests

For a target funding preview, use allocations preview with an explicit month. For SAVINGS targets,
supply --calculation-timezone with the native app device timezone. Ask for this timezone if it is
unknown. For overspending followed by targets, use allocations preview --strategy smart. Read its
restrictions before use. The CLI calculates eligibility, priority, requested amounts, partial
funding, and shortfalls from saved data. It supports a limited set of ordinary zero-based budgets
and target types. An unsupported input stops the preview. Do not calculate missing amounts or
reproduce a rejected workflow with a chain of commands. The preview reports executionSupported:false
and cannot save allocations.

For allocation records, use allocations history. For category and nature totals, use allocations
report. For positive historical averages, use allocations averages with an explicit reference month.
For raw target settings, use targets list. Category availability is not target progress. For a new
ordinary monthly spending target, use targets create CATEGORY_ID --amount-minor AMOUNT --carry-over
NONE. Choose ALL or NONE explicitly for the target carryover policy. For changing its amount and
target carryover policy, use targets update with the same required flags. Use an explicit budget and
inspect --dry-run --full before submitting either operation. Creation requires an absent target
field and records the current time at native whole-second precision. Update requires a complete
known target shape with a native whole-second creation timestamp. Like the native spending editor,
changing settings renews createdAt from the current clock; review both timestamps in the preview.
Unknown target fields, fractional creation times, non-native timestamp representations, and
unsupported schedules block editing. The target carryover policy affects target demand; it does not
change the category carryover policy or saved funds. These writes replace the complete target under
its snapshot version; they do not save money or allocation history. After an uncertain outcome or
marker-only confirmation, read targets list before another command. Do not blindly retry. For
removing an existing ordinary monthly spending target, use targets remove CATEGORY_ID with an
explicit budget and --dry-run. The subset requires a flat active DEFAULT category with
modifiable:true and a complete known target shape. Repeat intervals, savings targets, snooze
schedules, and hierarchy remain guarded. Raw account links remain untouched and uninterpreted;
native target removal does not consume them. Removal deletes the whole target under its snapshot
version. Stored account money, category funding, and history are not directly changed. Future target
demand and automatic funding suggestions intentionally change. Preview the complete previous target
before submitting. Target changes do not repair funding or a carryover discrepancy. Other target
types and schedules remain unsupported.

For one manual allocation, use allocations set --dry-run with --amount-minor or --match-linked. The
CLI calculates the complete pool, availability, linked-account diagnostics, and native history
effects. Use --plan-file to save the reviewed private plan. Apply it with allocations apply --plan
and an explicit new --request-id. The plan expires after 15 minutes. Any changed dependency requires
a new preview and request ID. Matching uses one active savings account's cleared balance. Several
active accounts require a separate aggregate policy. For an identical allocation retry, reuse the
original plan and request ID. Inspect allocations operation or allocations recover. Keep BEBU_HOME
and its permanent operation records. An unknown outcome requires observation; recover does not
resend it. Allocation recovery relies on the trusted local record and native marker, with no
cross-device payload binding. For overspending coverage, reallocation, automatic income allocation,
or allocation undo, use the native Beyond Budget app. CLI income does not fund categories. Uncleared
income changes only the uncleared account balance. Clearing income moves the amount into the cleared
balance and account history. Unclearing reverses those movements. Cleared, completed income
increases allocation resources in a zero-based budget. Income history requires agreement between its
stored month and its due-date month in the CLI runtime timezone. Native income allocation,
linked-account allocation, and bulk allocation are separate workflows. Their availability depends on
the native app and its settings.

A completed CLI card expense can overspend its category and increases the linked payment category's
otherAmount by the full amount. Use transactions create with type REFUND, positive amountMinor, a
credit-card accountId, and an expense categoryId for a refund. A refund reduces card debt, category
spending, and the linked payment reserve. It is stored as a positive OUTFLOW with subtype REFUND.
New refunds use editable:false, matching the native refund screen. Dry runs show editable; the CLI
rejects later updates and deletion. Expense categories linked to other accounts still require the
native app. These effects do not allocate category funds. Historical dueAt timestamps remain intact;
completed entries need a saved period. An uncleared expense or refund changes only the uncleared
account balance. Clearing moves it into the cleared balance and account history. Category spending
and reserve effects apply regardless of clearing. History months use the CLI runtime timezone.
Category refund spending history decreases; payee/tag spending history uses the absolute amount,
matching the native app.

## Preview and retry

Before a transaction change, inspect --dry-run. The summary shows metadata, account balances,
category funds, and allocation resources before and after. The summary explicitly reports
automaticAllocation:false. Add --full to inspect the Firestore writes and preconditions. A preview
describes the current snapshots. A later command reads fresh snapshots and can produce different
results.

If category availability or allocation resources change before a later saved month, transaction
execution is blocked. This covers category-only reassignment, creation, updates, and deletion,
including recurring scopes. The dry run reports executionSupported:false and
summary.downstreamCarryover with existing residuals and affected months. The CLI does not predict or
write later-period amounts. Future period materialization remains unverified. Preserve unexplained
discontinuities while investigating their cause. Metadata-only and obligation-only changes retain
their usual guards.

Use transactions create with frequency to create an expense, income, or card-refund series. Supply
optional repeatCount and nonWorkingDayPolicy. repeatCount includes the initial payment; null, zero,
or omitted means unlimited. A new series starts at sequenceCount 1. Ongoing series start incomplete,
even when due today or earlier; omit completed or use false. A repeatCount of 1 is valid. An
already-due single-payment repeat is completed; a future one remains upcoming. Future workday shifts
preserve timezone, local time, and monthly anchors. The adjusted date selects the budget period.
Upcoming recurring entries can be periodless. Completed entries need an existing period; no missing
period is created. Creation saves one initial occurrence with obligations, indexes, and usage
counts. Use the native app to complete it and generate successors. Do not mark an ongoing new series
completed or manufacture clone links to bypass this boundary.

Use transactions update for amounts, account/category assignments, payees, tags, dates, cleared
status, and metadata. For upcoming recurring entries, it also accepts frequency, repeatCount, and
nonWorkingDayPolicy. Use recurrenceScope THIS_PAYMENT for one upcoming amount/date override;
THIS_AND_LATER is the default. Existing generated occurrences require separate edits. The update
command does not complete payments or generate occurrences. Read transactions update before editing
a schedule. The CLI handles workday shifts, repeat limits, and month-end anchors.

Use transactions delete --scope THIS_PAYMENT to delete one occurrence and preserve its
already-generated remaining series. An ongoing tail without a generated successor cannot use
THIS_PAYMENT; the CLI cannot generate a replacement. A finite tail whose repeat limit is exhausted
can use THIS_PAYMENT. Use --scope THIS_AND_LATER to delete the selected occurrence and its verified
forward clone chain. Earlier history remains intact. The CLI follows validated transaction links; a
shared eventId does not identify a deletion chain. Earlier nonempty clone links remain unchanged,
even if their child is deleted. Do not clear these links. Inspect the dry run's deletedTransactions,
preservedTransactions, and ledger effects before committing. Every deletion scope requires an
editable canonical record with matching transaction and budget identities.

Transactions with active native allocation predicates, allocation history, or autoAllocated extras
reject deletion, financial edits, and schedule edits. Inactive allocation flags alone do not block
supported edits or deletion. Updates preserve recurring clone links and never rewrite another
occurrence. Notes, color, sentiment, location, and reminder metadata remain editable within the
command's other restrictions. Do not remove allocation flags or history to bypass a rejection.

Transaction commands permanently bind each live request to actor, budget, action, transaction, and
original input in BEBU_HOME. They save the exact compiled commit body before dispatch. Keep these
permanent operation records. For inspection, use transactions operation REQUEST_ID with an explicit
budget. For marker and current-version observations, use transactions recover REQUEST_ID with the
same budget. Both matching retries and recovery only observe; they never resend, including requests
previously rejected. Recovery checks at most 50 submitted document versions and reports the
remaining count. These reads are not one snapshot. Marker presence and current values do not
establish an unknown outcome; native markers contain no payload hash. Commit errors retain native
error codes and preconditions in commitDiagnostic alongside local operation status. After an
authoritative rejection, review fresh state and a new dry run before using a new request ID. For
create, preserve the resolved transaction identity and date from the saved submission; inspect
before creating any replacement. For sending or unknown outcomes, keep the request identity and
observe. Do not send a replacement to work around uncertainty. Missing or corrupt local records, old
untracked requests, and other installations lack the durable binding guarantee. Local record loss
and marker expiry do not authorize replay.

## Command reference

| Command                       | Type     | Description                                                                                 | Documentation                                                            |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `bebu`                        | group    | A command-line tool for Beyond Budget accounts and transactions.                            | [commands/bebu.md](commands/bebu.md)                                     |
| `bebu accounts`               | group    | Read accounts and change their configuration                                                | [commands/accounts.md](commands/accounts.md)                             |
| `bebu accounts list`          | runnable | List account IDs and balances in integer minor units                                        | [commands/accounts/list.md](commands/accounts/list.md)                   |
| `bebu accounts show`          | runnable | Read a complete account record                                                              | [commands/accounts/show.md](commands/accounts/show.md)                   |
| `bebu accounts update`        | runnable | Change the account configuration. Use schema for the accepted JSON fields                   | [commands/accounts/update.md](commands/accounts/update.md)               |
| `bebu allocations`            | group    | Plan and save manual allocations, inspect history, or preview target funding                | [commands/allocations.md](commands/allocations.md)                       |
| `bebu allocations apply`      | runnable | Apply one reviewed manual allocation plan atomically                                        | [commands/allocations/apply.md](commands/allocations/apply.md)           |
| `bebu allocations averages`   | runnable | Read average allocation and spending from prior saved months                                | [commands/allocations/averages.md](commands/allocations/averages.md)     |
| `bebu allocations history`    | runnable | Read native allocation history, optionally with matching transactions                       | [commands/allocations/history.md](commands/allocations/history.md)       |
| `bebu allocations operation`  | runnable | Inspect the original local allocation operation without sending writes                      | [commands/allocations/operation.md](commands/allocations/operation.md)   |
| `bebu allocations preview`    | runnable | Calculate target or restricted smart funding without changing the budget                    | [commands/allocations/preview.md](commands/allocations/preview.md)       |
| `bebu allocations recover`    | runnable | Observe the original allocation marker without resending uncertain work                     | [commands/allocations/recover.md](commands/allocations/recover.md)       |
| `bebu allocations report`     | runnable | Summarize monthly allocations by category and nature                                        | [commands/allocations/report.md](commands/allocations/report.md)         |
| `bebu allocations set`        | runnable | Preview one absolute allocation or match its linked savings account                         | [commands/allocations/set.md](commands/allocations/set.md)               |
| `bebu auth`                   | group    | Sign in through your browser and manage the saved connection                                | [commands/auth.md](commands/auth.md)                                     |
| `bebu auth login`             | runnable | Connect through your Chrome session. If necessary, wait for sign-in                         | [commands/auth/login.md](commands/auth/login.md)                         |
| `bebu auth logout`            | runnable | Delete local credentials and the separate bebu profile. Your Chrome profile stays intact    | [commands/auth/logout.md](commands/auth/logout.md)                       |
| `bebu auth status`            | runnable | Show saved connection state as JSON                                                         | [commands/auth/status.md](commands/auth/status.md)                       |
| `bebu budget`                 | group    | Read budget diagnostics                                                                     | [commands/budget.md](commands/budget.md)                                 |
| `bebu budget diagnostics`     | runnable | Read stored account/category links and allocation settings with their source paths          | [commands/budget/diagnostics.md](commands/budget/diagnostics.md)         |
| `bebu categories`             | group    | Read categories and change supported names or hierarchy                                     | [commands/categories.md](commands/categories.md)                         |
| `bebu categories attach`      | runnable | Make an ordinary category a direct subcategory                                              | [commands/categories/attach.md](commands/categories/attach.md)           |
| `bebu categories carryover`   | runnable | Audit stored category carryover across saved months without financial writes                | [commands/categories/carryover.md](commands/categories/carryover.md)     |
| `bebu categories detach`      | runnable | Move an ordinary subcategory out of its parent                                              | [commands/categories/detach.md](commands/categories/detach.md)           |
| `bebu categories funding`     | runnable | Read category funds for one month in integer minor units                                    | [commands/categories/funding.md](commands/categories/funding.md)         |
| `bebu categories list`        | runnable | List category IDs and types                                                                 | [commands/categories/list.md](commands/categories/list.md)               |
| `bebu categories rename`      | runnable | Rename one category without changing financial or hierarchy fields                          | [commands/categories/rename.md](commands/categories/rename.md)           |
| `bebu groups`                 | group    | Read groups and rename supported ordinary groups                                            | [commands/groups.md](commands/groups.md)                                 |
| `bebu groups list`            | runnable | List group IDs, names, and modification settings                                            | [commands/groups/list.md](commands/groups/list.md)                       |
| `bebu groups rename`          | runnable | Rename one group without changing financial or hierarchy fields                             | [commands/groups/rename.md](commands/groups/rename.md)                   |
| `bebu payees`                 | group    | Read payees                                                                                 | [commands/payees.md](commands/payees.md)                                 |
| `bebu payees list`            | runnable | List IDs and usage counts for payees                                                        | [commands/payees/list.md](commands/payees/list.md)                       |
| `bebu schema`                 | runnable | Show JSON schemas for write payloads                                                        | [commands/schema.md](commands/schema.md)                                 |
| `bebu session`                | group    | Import authentication from a signed-in browser                                              | [commands/session.md](commands/session.md)                               |
| `bebu session import`         | runnable | Import one session source. Playwright state must include IndexedDB                          | [commands/session/import.md](commands/session/import.md)                 |
| `bebu session prepare`        | runnable | Prepare an encrypted session handoff without credentials in the output                      | [commands/session/prepare.md](commands/session/prepare.md)               |
| `bebu session status`         | runnable | Show session expiry and budget IDs without credentials                                      | [commands/session/status.md](commands/session/status.md)                 |
| `bebu skills`                 | group    | Generate or install the bebu agent skill                                                    | [commands/skills.md](commands/skills.md)                                 |
| `bebu skills generate`        | runnable | Generate references and refresh an existing managed local bebu skill copy                   | [commands/skills/generate.md](commands/skills/generate.md)               |
| `bebu skills install`         | runnable | Generate and copy the bebu skill into .agents/skills in this project                        | [commands/skills/install.md](commands/skills/install.md)                 |
| `bebu tags`                   | group    | Read tags                                                                                   | [commands/tags.md](commands/tags.md)                                     |
| `bebu tags list`              | runnable | List IDs and usage counts for tags                                                          | [commands/tags/list.md](commands/tags/list.md)                           |
| `bebu targets`                | group    | Inspect, create, edit, or remove supported monthly spending targets                         | [commands/targets.md](commands/targets.md)                               |
| `bebu targets create`         | runnable | Create a positive monthly spending target                                                   | [commands/targets/create.md](commands/targets/create.md)                 |
| `bebu targets list`           | runnable | Read target settings separately from category funds                                         | [commands/targets/list.md](commands/targets/list.md)                     |
| `bebu targets remove`         | runnable | Remove a monthly spending target without changing stored funding                            | [commands/targets/remove.md](commands/targets/remove.md)                 |
| `bebu targets update`         | runnable | Edit a positive monthly spending target                                                     | [commands/targets/update.md](commands/targets/update.md)                 |
| `bebu transactions`           | group    | Read history and edit expenses, income, and upcoming recurring payments                     | [commands/transactions.md](commands/transactions.md)                     |
| `bebu transactions create`    | runnable | Create one-off or recurring expenses, income, and card refunds without automatic allocation | [commands/transactions/create.md](commands/transactions/create.md)       |
| `bebu transactions delete`    | runnable | Delete one occurrence or a verified recurring chain with atomic ledger reversal             | [commands/transactions/delete.md](commands/transactions/delete.md)       |
| `bebu transactions list`      | runnable | Read the complete history, including older records absent from the app cache                | [commands/transactions/list.md](commands/transactions/list.md)           |
| `bebu transactions operation` | runnable | Inspect a durable local transaction operation                                               | [commands/transactions/operation.md](commands/transactions/operation.md) |
| `bebu transactions recover`   | runnable | Observe a saved transaction request without resending financial writes                      | [commands/transactions/recover.md](commands/transactions/recover.md)     |
| `bebu transactions show`      | runnable | Read a complete transaction record                                                          | [commands/transactions/show.md](commands/transactions/show.md)           |
| `bebu transactions update`    | runnable | Edit transaction amounts, details, dates, and upcoming recurrence rules                     | [commands/transactions/update.md](commands/transactions/update.md)       |
