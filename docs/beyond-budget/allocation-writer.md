# Manual Allocation Writer

Use `allocations set --dry-run` to calculate one absolute allocation or match one linked savings
account. Save the reviewed plan with `--plan-file`, then run `allocations apply --plan` with an
explicit request ID. See the
[generated command reference](../../skills/bebu/commands/allocations/set.md) for exact arguments.

## Supported Cases

The writer supports the current existing month of a consistent zero-based budget without an active
challenge. The selected category must be an active DEFAULT leaf with COMPUTE and ALL carryover.
Manual FUND_OVERRUNS allocation is supported independently of target eligibility. One-level
hierarchy and payment categories elsewhere contribute to the complete signed pool. Parent, income,
and payment categories remain unsupported write targets.

One existing next month may contain allocations and upcoming bills. Next-month income, spending,
other funds, and multiple later periods remain unsupported. The writer observes derived carryover
after committing; it never patches later periods directly. A delayed update returns committed with
synchronization pending. Recovering observes it again without another submission.

Negative absolute allocations and reductions that release assignments are valid. A positive delta
must fit the unallocated pool. An unchanged allocation creates no history or financial writes.
Account matching uses exactly one active linked savings account's cleared balance. Several active
accounts require an aggregate policy that this command does not implement.

An archived linked savings account is tolerated only with zero cleared and uncleared balances and an
empty reverse link. The diagnostic reports `archived-zero-orphan`; the writer preserves the
discrepancy. Missing, duplicate, contradictory, foreign-currency, and unsupported account links are
rejected.

## Review And Apply

Plans contain the calculated result, exact source versions, fixed history and marker identities,
timestamps, and compiled writes. The private file contains financial data and actor identity, but no
credentials. The SHA-256 hash detects edits; it is not a signature or remote authorization
mechanism. Apply recompiles the operation from a fresh transactional snapshot and compares the
complete plan.

A plan expires after 15 minutes. Every changed dependency makes it stale, including configuration
and account indexes. Create a new preview and request ID after a definite rejection. Rejected or
unknown apply outcomes return structured errors and a nonzero exit code. Operation inspection and
recovery report the saved state without submitting financial writes.

The writer atomically saves the selected period, category historical allocation, budget MANUAL
history, and native marker. It preserves account money, account links, and canonical transactions.
The root exception permits one masked allocation-history entry and USER change source. Other
existing write paths retain their root restriction.

## Operation Records And Recovery

Operation records live under `BEBU_HOME/allocation-operations`, scoped by actor, budget, project,
and database. An exclusive permanent request directory selects one sender and remains as the request
tombstone. It is never unlocked, reused, or pruned by the CLI. Plan and state files use private
permissions, file synchronization, atomic rename, and directory synchronization. The directory
hierarchy is synchronized before sending. Directory synchronization currently requires filesystem
support, such as the validated Linux/WSL environment.

Only the caller that created the claim may send, after persisting `sending`. Other callers inspect
or recover. Changed content under the same request ID fails. A partial record, missing record, or
corrupt record never permits a replacement submission under that request.

Recovery distinguishes marker absence from read denial and transport failure. An absent marker while
the sender may be running remains unknown. The native marker and trusted local record support
recovery on the same installation. There is no permanent shared payload binding, cross-device
deduplication, or recovery guarantee after local-record loss. Keep the operation directory when
moving or backing up the CLI state.

A known commit remains committed even if synchronization is pending or local result persistence
fails. Recovered marker creation time is reported separately from an acknowledged API commit time. A
missing expired marker cannot establish that an operation never committed.

## Validation Evidence

The [sanitized fixtures](fixtures/allocation-writes-2026-10-25.json) cover native ordinary and
linked saves, negative amounts, archived zero links, FUND_OVERRUNS, next-month allocation/upcoming
preservation, and a deployed CLI save. Controlled hierarchy and payment-category fixtures produced
the same unallocated pool in the native app and CLI. Primary's read-only previews matched its native
zero pool and current category availability. Primary received no financial writes during
implementation validation.

Tests exercise unordered transaction reads, complete dependency protection, write masks, edited
plans, request conflicts, lost acknowledgments, denied or absent markers, and a child-process exit
after durable `sending`. A separate inspection/recovery path cannot issue another financial commit.

The [investigation plan](allocation-write-plan.md) preserves artifact identity, protocol sources,
and deferred workflows. Undo, native reallocation, automatic linked-income allocation, bulk
overspending coverage, and smart execution remain separate work.
