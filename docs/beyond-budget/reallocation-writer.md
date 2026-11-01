# Reallocation Writer

Use `allocations reallocate` to move funds between two supported categories. Use the generated
[command reference](../../skills/bebu/commands/allocations/reallocate.md) for syntax. Review
`--dry-run --full` before a live command. Live commands read fresh snapshots.

## Supported Subset

- Explicit budget, source, destination, positive safe integer minor-unit amount, month, and native
  device calculation timezone.
- ZERO_BASED budget without a current challenge. Selected month is current or future and is the
  latest saved month.
- Matching period, category, group, stash, and account identities.
- Active, modifiable DEFAULT categories and groups. Categories have explicit ALL carryover and empty
  account link lists.
- Flat categories without children, targets, aggregation, computation, accumulation, or challenge
  settings.
- Every account provides an explicit reciprocal link field and excludes both selected categories.
- Both categories provide explicit safe allocated, carried-over, other, spent, and upcoming amounts.
- Explicit monthly category allocation histories match the saved period allocations. Counters are
  explicit and safe.
- All four preview stashes have `trimmed:false`, matching completed counts and maps, and valid
  completed preview identities.
- Each stash contains fewer than 20 completed previews and occupies at most 25,000 JSON bytes before
  insertion.
- Source availability covers the transfer. All resulting amounts remain safe integers.

These restrictions define CLI coverage. They are not claims about every native picker restriction.
Missing fields remain unknown and stop execution. Do not add financial defaults to admit a
production record. Historical propagation, later period creation, linked categories, hierarchy,
broader targets, large indexes, and undo remain unsupported.

## Native Contract

Function numbers refer to the artifact in [Source Reconstruction](source-reconstruction.md). The
ordinary screen calls `62959 → 50911 → 50902 → 50916` to save a REALLOCATE_MONEY transaction.
Handler `51763` updates the period, categories, and indexes. The screen then calls `50271 → 50296`
to save root history separately.

For a positive transfer `M`, the transaction stores `amount=-M` and two unlinked CATEGORY targets.
It is completed, cleared, unreconciled, noneditable, ONE_OFF, and version 1. Both allocation
capability flags are true; extras, tags, and files are empty. The CLI preserves this constructor and
the native completed preview projection, including integrity count 1.

| Document                                            | Direct Effects                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Selected period                                     | Source allocated amount decreases by M; destination increases by M                       |
| Category index                                      | Both transaction counts increase by one; no lastTransactionAt write                      |
| Global, period, source, destination preview stashes | Insert the completed preview; all four completed counts increase by one                  |
| Source and destination category stashes             | Monthly historical allocations decrease/increase by M                                    |
| Canonical transaction                               | Create one native REALLOCATE_MONEY record                                                |
| Budget root                                         | Add one MONEY_REALLOCATION history entry, keyed by transaction ID, and changeSource USER |

History stores the source's original allocation as `beforeAmount` and positive transfer amount as
`afterAmount`. The latter is not either resulting allocation. It stores source/destination category
IDs, selected period, empty account ID, null undoneAt, overallocationStatus NONE, and
overallocationAmount 0. Native `50296 → 22157` uses client Timestamp.now(); the history timestamp is
not the marker's server timestamp.

Current-month transactions use the current clock. Other selected months use their last day with the
current runtime local time. Transaction timestamps have whole-second precision. The selected
due-date month must agree in runtime and saved user timezones. Pass the native device timezone
explicitly; it must match the CLI runtime timezone.

These direct writes do not change account money, allocation resources, spent/other/carried-over
amounts, or upcoming obligations. They do not establish the behavior of future period
materialization.

## Atomic Persistence And Recovery

The native screen has two save boundaries. The CLI deliberately consolidates them into one
optimistic Firestore transaction. Root, user, category/group index, accounts, period, all four
indexes, and canonical absence are snapshot dependencies. Versions protect every modified document;
canonical and marker creation require absence. A stale dependency rejects the complete envelope
before financial effects.

Permanent transaction operation records bind intent, generated identities, exact commit body, hash,
and sending state before dispatch. The root write permits exactly one masked allocation-history
entry and changeSource. Whole-budget replacement remains prohibited. A valid acknowledgment must
include one write result for every submitted write, including the marker.

Use `transactions operation REQUEST_ID` or `transactions recover REQUEST_ID` with the same explicit
budget after uncertainty. Existing requests only observe. No retry or recovery repeats either
component, including after an authoritative rejection. An uncertain request must not receive a
replacement ID. Native markers and current document values cannot prove its outcome. Recovery
observes root history versions as well as child documents; these bounded reads are not one
consistent snapshot. Untracked, lost, corrupt, cross-device, and lost-acknowledgment cases still
lack payload-bound remote proof.

## Validation Evidence

An authorized disposable-budget native transfer and opposite transfer established the full direct
write set and both native histories. A controlled lab fixture supplied explicit synthetic operands;
no absent production amount was interpreted as zero. The deployed service accepted a CLI atomic
transfer containing both logical components in one request. Read-only comparisons check canonical
fields, all four previews/counters, both category histories, period amounts, root history, and
unchanged accounts, resources, carryover, other periods, and unrelated configuration.

Regression tests cover write-set semantics, all four counts, history amount meaning, stale
dependencies, explicit operand guards, identity collisions, insufficient funds, overflow,
unsupported timezones, rejected envelopes, and lost responses without replay. Separate recovery
tests inspect the durable body before dispatch and reject incomplete acknowledgments. This bounded
evidence does not resolve the historical migration discrepancy or authorize its held transfer.
