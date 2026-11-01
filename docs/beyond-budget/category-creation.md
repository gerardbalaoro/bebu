# Ordinary Category Creation

The worktree implements `categories create` from retained native creation evidence. Deployed CLI
creation still needs disposable-lab verification before production use.

Supply an explicit budget, group, name, icon, and color. Use `categories list --full` to find
existing icon and color codes. Preview with `--dry-run --full`.

## Native Evidence

Two individually acknowledged native creations establish the same complete category constructor and
empty CATEGORY stash. Each original acknowledgment covers three writes, including the save marker.
Complete before/after snapshots preserve existing document values, canonical transactions, category
records, and financial state.

The native index update masks exactly one new category entry. The new stash contains only its ID,
CATEGORY type, and empty data map. Neither operation writes period balances, accounts, allocation
history, funding, or transactions.

Both creations append after the highest stored peer order, including gaps. Evidence does not
establish ordering for empty groups or mixed parent/child families.

The new constructor uses DEFAULT type, ALL carryover, UNCATEGORIZED nature, native
computation/accumulation settings, and no parent, account links, or target. These values initialize
a new record. They do not supply missing values on existing financial records.

## CLI Subset

The budget must be ordinary ZERO_BASED without a challenge. The selected group must be active
DEFAULT with matching identity and explicit modifiable:true.

The selected group must be nonempty and flat. Every peer needs an explicit unique safe order and
name. Every category needs matching identity and explicit group membership. Creation appends after
the highest peer order. Duplicate names within the group are rejected without changing existing
records.

Icon and color are required and must already appear in the category index. This is a conservative
CLI policy, not a complete native enum catalog. Names use the existing 1–200 trimmed-character CLI
policy.

Group creation, empty groups, hierarchy, alternate policies, targets, account linking, archive, and
reordering remain unsupported. Creation does not enable a historical transaction edit or repair
category funding.

## Persistence And Recovery

One optimistic Firestore transaction reads the root, complete category/group index, and generated
stash absence. The index patch retains its version precondition. Stash creation requires absence.
Concurrent changes reject the envelope; no existing category or stash is replaced.

Permanent operation records bind actor, budget, creation input, generated identity, and exact body
before dispatch. A complete acknowledgment must cover both writes and the marker. Use
`transactions operation` or `transactions recover` with the original request ID after uncertainty.

An existing request only observes. Lost responses, incomplete acknowledgments, missing records, or
marker-only observations never authorize replacement or replay. Keep BEBU_HOME and its permanent
records.

## Validation Status

Synthetic tests exercise the native constructor, narrow index mask, empty stash, ordering,
eligibility, name/style checks, identity collisions, and CLI flags. They also cover stale
dependencies, lost responses, incomplete acknowledgments, request binding, and observe-only
recovery.

The retained native saves establish the creation contract. They do not prove deployed acceptance of
the new CLI envelope. A disposable-lab CLI creation and complete document/acknowledgment comparison
remain required. Browser and main-checkout ownership must be handed off before that experiment.
