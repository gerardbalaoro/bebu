# Category Group Moves

Use `categories move ID --from-group OLD --group NEW --budget BUDGET --dry-run --full` to review a
bounded append move. To execute the reviewed intent, omit `--dry-run` and supply a new
`--request-id`. The command appends one ordinary category to a later ordinary group.

## Retained Client Contract

This trace uses the module and decoded WAT identified in
[Source Reconstruction](source-reconstruction.md). Both hashes matched during the offline
investigation. No browser, saved auth, or live budget read supplied this evidence.

The group/category editor passes its category map to `66207 → 50473 → 50490` after moves. Writer
50490 groups categories by group ID and sorts each group by stored order through comparator 48078.
Starting at -1, it retains each order if it exceeds the previous result. Otherwise, it uses the
previous result plus one. It patches each supplied category's group ID and resulting order.

The category-drop path in 65933 uses helper 65939 when the destination belongs to another group.
When the destination group follows the source group, dropping on its last category supplies that
category's order plus one. An earlier destination uses a different placement branch. The helper also
moves children when present. The CLI excludes earlier destinations and that family case.

With unique affected peer orders, append moves do not require peer order changes. The CLI patches
only the source category's group ID and order under the index version precondition. Native and
deployed CLI fixtures established this narrow patch's acceptance and preserved all other raw values.

## Supported Subset

The budget must be ordinary ZERO_BASED without a challenge. Both groups and the source category must
be active DEFAULT records with matching identities and explicit modifiable:true. Both groups need
explicit native integer orders. The destination must follow the source group.

The source requires an explicit expected current group. It must have no parent, children, target, or
stored account links. An absent link-list field remains absent. An explicit null or malformed list
rejects the preview. Other settings remain uninterpreted and unchanged.

The destination must be nonempty and flat. Affected peers require explicit unique nonnegative orders
within the native signed 32-bit range. The highest destination order must permit an increment.
Archived or deleted peers reject the preview because their native ordering needs separate evidence.
Other source-group families can remain if their orders are unique and the moved source is childless.

The complete account index must identify every account and supply an explicit category link field.
Any account linked to the source rejects the operation. Missing account-link evidence also rejects
it. The command does not infer absent links or change account configuration.

The preview reads the root, complete category index, and complete account index in one read-only
transaction. These reads validate the patch; they do not constitute a complete budget audit. A dry
run creates no operation record. Renames remain separate commands.

## Recorded Lab Validation

Two native append fixtures retained their original complete two-write acknowledgments. One moved a
sparse category with existing transactions and history. The other moved a complete native category.
Complete raw comparisons covered 89 and 90 budget documents, six saved months, and all 12 canonical
transactions. Only the selected category's group ID and order changed. Absent source settings stayed
absent.

The native request included unchanged peer group/order pairs. The deployed CLI fixture omitted those
no-op fields and received its original complete two-write acknowledgment. All 90 raw document values
matched the expected copy with only the selected category's two fields changed. Existing
allocations, histories, account balances, links, flags, targets, transactions, and unknown fields
remained unchanged.

An earlier smooth drag committed an intermediate group move before the final move. Both original
two-write acknowledgments and their complete index versions are retained. That gesture also changed
peer order and is not equivalent to bounded append. A direct source-local drag start, followed by
one transition to the last destination row, produced the verified append effect in one save.

In the narrow native layout, use Menu, scroll down, then open Groups and categories. Review native
ordering effects independently; a general drag path can reorder other categories.

## Execution And Recovery

Live execution claims a permanent local request identity before planning. The manifest binds the
budget, actor, action, and original intent. The submission retains the exact body and optimistic
transaction. Root, category-index, and account-index reads share that transaction. Conflicts do not
retry.

Only the complete original commit acknowledgment establishes success. Use `transactions operation`
or `transactions recover` with the original ID to inspect an existing request. These commands
observe only. Never replay or replace a sending or unknown request, and retain permanent operation
records. A marker or matching current values cannot replace a lost original acknowledgment.

Reverse moves, empty destinations, subtrees, targets, linked sources, ambiguous peer order, and
missing account-link evidence remain unsupported. No transaction guard changes as part of this
workflow.

Group membership intentionally changes grouped reports and can change future ordering behavior.
Unchanged current account balances do not establish unchanged future automatic allocation decisions.
