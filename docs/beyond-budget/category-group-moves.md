# Category Group Move Preview

`categories move ID --from-group OLD --group NEW --budget BUDGET --dry-run --full` previews a
bounded append move. It reports `executionSupported:false`. Live execution requires separate native
and deployed CLI lab evidence. Omitting `--dry-run` rejects the command before authentication.

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
moves children when present. The preview excludes earlier destinations and that family case.

With unique affected peer orders, append moves do not require peer order changes. The candidate
proposes only the source category's group ID and order under the index version precondition. This
narrow patch is derived from the retained writer. Runtime evidence must establish its deployed
acceptance and any server effects.

## Preview Subset

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

The preview reads only the root and complete category index in one read-only transaction. Those
reads select and validate the proposed patch. They do not constitute a complete budget audit. No
operation record, account change, transaction change, funding restoration, or name change occurs.
Renames remain separate commands.

## Required Lab Checkpoint

1. Obtain exclusive browser ownership before the experiment.
2. Capture the raw root and every document in every budget collection in one consistent snapshot.
3. Select a childless ordinary category and a nonempty flat destination in a later group with
   distinct orders.
4. Move the category natively after the destination's last category.
5. Retain the original complete acknowledgment and exact request body.
6. Compare every raw value, including secondary stashes, saved periods, and all canonical
   transactions.
7. Establish the native order and peer-write contract before adding a CLI execution branch.
8. Verify the deployed CLI envelope and durable outcome handling in the lab before enabling
   production execution.

The fixture must include existing category history and saved months. A separate sparse-source
variant must establish preservation of absent settings. No missing financial value becomes a
default. Targeted, linked, empty-destination, subtree, and duplicate-order families remain separate
cases.

Group membership intentionally changes grouped reports and can change future ordering behavior.
Unchanged current account balances do not establish unchanged future automatic allocation decisions.
