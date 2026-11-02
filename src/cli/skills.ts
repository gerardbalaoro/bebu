import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { CustomPromisify } from "node:util";

import { defineCommand } from "@crustjs/core";
import type { AnyCrust } from "@crustjs/core";
import { writeSkills } from "@crustjs/skills";
import { z } from "zod";

import metadata from "../../package.json" with { type: "json" };

const ExecFile: CustomPromisify<typeof execFile.__promisify__> = execFile;
const executeFile = promisify(ExecFile);
export const packagedSkills = fileURLToPath(new URL("../../skills", import.meta.url));
const generatedSyntaxSection = /## Command Documentation Authority\n\n.*?(?=\n---)/su;

const openaiMetadata = `interface:
  display_name: "Beyond Budget"
  short_description: "Read and change Beyond Budget accounts and transactions"
  default_prompt: "Use $bebu to review my Beyond Budget accounts and transactions."
`;

const skillInstructions = `# bebu

Before you use the app, read [the login and write rules](commands/bebu.md).

## Run commands

If bebu is installed, use the command signatures as written.
Otherwise, replace the initial bebu with npx --yes github:gerardbalaoro/bebu.
A global CLI installation is not required.

## Choose a command

1. Find the command for the task in the command reference.
2. Read the Type column. Only runnable commands accept direct execution. A group without an action contains other commands.
3. Before you use or explain a command, read its linked reference.
4. Use only the arguments, flags, aliases, and defaults in that reference.
5. If a feature is absent, report that the reference does not document it.

## Money and category funds

Account balances describe money or debt in accounts. Category funds describe budget assignments for a specific month.
For category funds, use categories funding with an explicit month. Keep otherAmount and carryover in the available amount.
Upcoming obligations are separate from available funds. This query does not calculate ready-to-allocate funds or parent totals.

For stored cross-period carryover, use categories carryover with an explicit budget and optional saved-month range.
The read-only snapshot reports raw residuals under explicit current ALL policies, with document versions.
Missing amounts, special categories, unsupported policies, and calendar gaps remain unknown without financial defaults.
A discontinuity does not establish an incorrect baseline. Zero residuals do not verify historical policy or propagation.

For account/category links or allocation settings, use budget diagnostics. Report the returned values with their document paths.
Unknown values and absent settings have no inferred meaning or default.

## Category and group names

Use categories rename ID --name NAME or groups rename ID --name NAME with an explicit budget and --dry-run.
Use groups list to find group IDs. Add --full to inspect the exact name-only patch.
The supported subset is active DEFAULT records with explicit modifiable:true and matching identities.
Names use a CLI limit of 1–200 trimmed characters. A rename preserves financial, hierarchy, target, and unknown fields.
After an uncertain rename outcome, inspect the current name before another command.
For a bounded hierarchy change, use categories attach ID --parent PARENT_ID or categories detach ID --parent EXPECTED_PARENT_ID.
Use an explicit budget and review --dry-run --full first. Parent intent is required for both commands.
Only active modifiable DEFAULT categories and groups, within one group and one level, are supported. The source cannot have children.
Every member of the affected parent family must lack target, aggregation, accumulation, and computation settings.
Stored link lists must be absent or empty. The complete account index must provide explicit link fields and exclude family links.
Absent category link lists remain absent; no financial defaults or link repairs are assigned.
Explicit safe orders must remain unambiguous. Attach writes the parent and group fields; detach deletes the parent field.
These operations preserve stored amounts and order but change parent coverage membership. Future funding outcomes are not predicted.
They do not repair carryover or enable historical transaction edits. Inspect categories list --full after an uncertain outcome.
Marker-only confirmation cannot prove the requested hierarchy change. Do not blindly retry.
Targeted or linked families, deeper trees, group creation, archive, and general reordering remain unsupported.
For a bounded append move, use categories move ID --from-group OLD --group NEW --budget BUDGET --dry-run --full.
Both groups must be ordinary, and the destination must be later, nonempty and flat. The source cannot have parents, children, targets or stored account links.
The complete account index must identify every account with an explicit category link field and exclude source links. Missing link evidence rejects the command.
Affected peer orders must be explicit and unique. Only the source groupId/order change; sparse settings and all financial records remain untouched.
Native and deployed CLI lab saves retained their complete original acknowledgments and all other raw document values.
Live moves use permanent payload-bound request records and one optimistic transaction. Unknown/sending outcomes must never be replayed or replaced.
Use transactions operation/recover to observe an existing request. Group membership can affect future funding and grouped reports.
A bounded categories create implementation requires explicit --budget, --group, --name, --icon and --color.
It supports nonempty flat ordinary groups with explicit safe unique orders and appends after the highest peer order.
Review --dry-run --full. The new native DEFAULT/ALL category and empty stash are saved atomically without financial writes.
Existing amounts and settings are untouched. No missing financial values are supplied.
Deployed disposable-lab creation preserved all existing documents and matched the original complete acknowledgment.
Permanent operation records bind the generated identity and body. Use transactions operation/recover after uncertainty; never replay or replace the request.

For retiring an ordinary category, use categories archive ID --budget BUDGET --month YYYY-MM with --dry-run --full.
Only the current month in the saved user timezone is supported. Review and move remaining funds before archiving; the command does not evaluate funding amounts.
Archive requires a childless active modifiable DEFAULT category, no target or explicit source account links, and no upcoming canonical/stash/template references.
Absent account link fields remain uninterpreted and unchanged. Historical transactions, allocations, balances and unknown fields remain unchanged.
The native patch sets archived and archivedAt and deletes parentCategoryId. It omits the unchanged template rewrite after snapshot validation.
Archive is visibility metadata, not deletion or carryover repair. Its live intent and exact body are durably bound before one optimistic commit.
After uncertainty inspect transactions operation/recover with the original request ID; never resend or replace an unknown/sending archive.

## Transaction history

Legacy transaction reads preserve absent fields without defaults. Inspect diagnostics and invalidRecords as well as transactions.
diagnostics identifies strict write-validation failures. invalidRecords retains raw decoded records with invalid field types.
For decoding failures, invalidRecords.fields preserves the original Firestore fields and diagnostics reports decode_error.
Without an account filter, follow nextPageToken until null, even when transactions is empty.
Account-filtered queries have no pagination. matched includes malformed records; scanLimitReached reports the 10,000-record scan boundary.
Missing allocation or link fields remain unknown and block writes through strict validation.
transactions show also preserves absent legacy fields and explicit null creators without adding write defaults.
Explicit createdBy:null is native-supported and remains null in canonical records and creator IDs in new index previews.
Absent creator, allocation, link-type, and version fields still fail strict write validation.
A narrow legacy card representation permits explicit null link type and version only with matching saved/current payment-category links.
This preserves saved targets and does not repair links. All other allocation, split, editability, and historical funding guards remain.


## Category-only migration

For one completed expense, use transactions reclassify with explicit --budget, --from-category and --category.
Read [Category Reclassification](../../docs/beyond-budget/category-reclassification.md) before using it.
This separate writer patches only the canonical category ID and transfers existing raw previews, counts and spending.
It preserves absent fields, versions, creator and reconciliation without rebuilding a native transaction model.
Account money, reserves, funding and allocation history receive no direct writes.
Preview --dry-run --full and verify account balances and saved periods after each historical action.
Historical carryover has no terminal receipt; propagationVerified:false is intentional.
General update/delete guards remain. Posted positive REFUND attribution preserves its original editable flag, including false.
Complete 2–20-member same-account/date expense splits retain every sibling. Completed recurrence and known debt references stay unchanged.
Locked non-refund records, mixed/incomplete splits, other extras and explicitly linked destination categories stay outside this subset.
Missing category/account link fields remain uninterpreted; explicit conflicting destinations reject. No link repair or financial defaults are supplied.
Original validated acknowledgments are retained with their submitted-body hash in permanent transaction operations.
Recovery still observes only and never infers a committed state from a marker or current values.

## Allocation requests

For a target funding preview, use allocations preview with an explicit month.
For SAVINGS targets, supply --calculation-timezone with the native app device timezone. Ask for this timezone if it is unknown.
For overspending followed by targets, use allocations preview --strategy smart. Read its restrictions before use.
The CLI calculates eligibility, priority, requested amounts, partial funding, and shortfalls from saved data.
It supports a limited set of ordinary zero-based budgets and target types. An unsupported input stops the preview.
Do not calculate missing amounts or reproduce a rejected workflow with a chain of commands.
The preview reports executionSupported:false and cannot save allocations.

For allocation records, use allocations history. For category and nature totals, use allocations report.
For positive historical averages, use allocations averages with an explicit reference month.
For raw target settings, use targets list. Category availability is not target progress.
For a new ordinary monthly spending target, use targets create CATEGORY_ID --amount-minor AMOUNT --carry-over NONE.
Choose ALL or NONE explicitly for the target carryover policy.
For changing its amount and target carryover policy, use targets update with the same required flags.
Use an explicit budget and inspect --dry-run --full before submitting either operation.
Creation requires an absent target field and records the current time at native whole-second precision.
Update requires a complete known target shape with a native whole-second creation timestamp.
Like the native spending editor, changing settings renews createdAt from the current clock; review both timestamps in the preview.
Unknown target fields, fractional creation times, non-native timestamp representations, and unsupported schedules block editing.
The target carryover policy affects target demand; it does not change the category carryover policy or saved funds.
These writes replace the complete target under its snapshot version; they do not save money or allocation history.
After an uncertain outcome or marker-only confirmation, read targets list before another command. Do not blindly retry.
For removing an existing ordinary monthly spending target, use targets remove CATEGORY_ID with an explicit budget and --dry-run.
The subset requires a flat active DEFAULT category with modifiable:true and a complete known target shape.
Repeat intervals, savings targets, snooze schedules, and hierarchy remain guarded.
Raw account links remain untouched and uninterpreted; native target removal does not consume them.
Removal deletes the whole target under its snapshot version. Stored account money, category funding, and history are not directly changed.
Future target demand and automatic funding suggestions intentionally change. Preview the complete previous target before submitting.
Target changes do not repair funding or a carryover discrepancy. Other target types and schedules remain unsupported.


For one manual allocation, use allocations set --dry-run with --amount-minor or --match-linked.
The CLI calculates the complete pool, availability, linked-account diagnostics, and native history effects.
Use --plan-file to save the reviewed private plan. Apply it with allocations apply --plan and an explicit new --request-id.
The plan expires after 15 minutes. Any changed dependency requires a new preview and request ID.
Matching uses one active savings account's cleared balance. Several active accounts require a separate aggregate policy.
For an identical allocation retry, reuse the original plan and request ID. Inspect allocations operation or allocations recover.
Keep BEBU_HOME and its permanent operation records. An unknown outcome requires observation; recover does not resend it.
Allocation recovery relies on the trusted local record and native marker, with no cross-device payload binding.
For a bounded category transfer, read allocations reallocate and preview with --dry-run --full.
Pass explicit --from, --to, --amount-minor, --month, --budget and --calculation-timezone values.
Only the latest saved current or future month and ordinary flat unlinked categories are supported.
The native device timezone must match the CLI runtime. Every consumed financial amount, counter,
link and monthly allocation history value must be explicit. All four preview indexes must be complete,
explicitly untrimmed, contain fewer than 20 entries, and occupy at most 25,000 JSON bytes each.
Missing fields stop execution without defaults. Source availability must cover the positive transfer.
The CLI saves the native REALLOCATE_MONEY transaction, category funds, indexes, counters, category
histories and MONEY_REALLOCATION history atomically. It consolidates the app's two save boundaries.
Use transactions operation/recover with the original request ID after uncertainty. Recovery and matching
retries only observe; neither resends. Keep BEBU_HOME and its permanent records. A marker or current
value cannot prove a lost acknowledgment. Live commands read fresh snapshots after the preview.
This workflow does not repair historical carryover or authorize the held migration transfer.
For unsupported reallocation shapes, automatic income allocation, or allocation undo, use the native app.
CLI income does not fund categories. Uncleared income changes only the uncleared account balance.
Clearing income moves the amount into the cleared balance and account history. Unclearing reverses those movements.
Cleared, completed income increases allocation resources in a zero-based budget.
Income history requires agreement between its stored month and its due-date month in the CLI runtime timezone.
Native income allocation, linked-account allocation, and bulk allocation are separate workflows. Their availability depends on the native app and its settings.

A completed CLI card expense can overspend its category and increases the linked payment category's otherAmount by the full amount.
Use transactions create with type REFUND, positive amountMinor, a credit-card accountId, and an expense categoryId for a refund.
A refund reduces card debt, category spending, and the linked payment reserve. It is stored as a positive OUTFLOW with subtype REFUND.
New refunds use editable:false, matching the native refund screen. These newly created refunds reject later updates and deletion.
An existing imported positive OUTFLOW/REFUND with explicit editable:true retains that value.
Its category edit uses signed refund effects and retains strict link, allocation, reconciliation, split and historical guards.
This existing CLI behavior does not establish a monitored native workflow for that imported shape.
For explicitly authorized monitored native allocation-capable or split category edits, read [Native Category And Split Edits](../../docs/beyond-budget/native-category-edits.md).
That evidence defines bounded native cases; it does not enable CLI execution through existing guards.
For an explicitly authorized native bulk category action, read [Native Bulk Category Edits](../../docs/beyond-budget/native-bulk-category-edits.md).
Verified subsets cover one complete known split child and one complete reconciled ordinary expense with an explicit null reconciliation timestamp.
Both retained original acknowledgments and preserved account money, explicit flags, saved links, and funding/history.
The split sibling remained raw-identical. Further native evidence covers a complete reconciled SAVINGS split child and an ordinary reconciled card expense, both with explicit null timestamps.
A complete ordinary SAVINGS expense also preserved its explicit saved link despite an explicit different current reciprocal account link.
Known creators can renew a null email to the same signed-in creator's email. Other creator fields must remain unchanged.
Older children absent from global previews used the filtered search-results Bulk update entry. Group-editor hydration remains unproved.
Read the exact fixture restrictions before execution. Missing fields, unknown creators, absent account links, positive refunds, and other reconciliation or split shapes remain unverified.
No CLI split, reconciliation, or link-conflict guard is removed. Never submit a partial group editor or infer missing financial values.
Expense categories linked to other accounts still require the native app.
These effects do not allocate category funds. Historical dueAt timestamps remain intact; completed entries need a saved period.
An uncleared expense or refund changes only the uncleared account balance. Clearing moves it into the cleared balance and account history.
Category spending and reserve effects apply regardless of clearing. History months use the CLI runtime timezone.
Category refund spending history decreases; payee/tag spending history uses the absolute amount, matching the native app.

## Preview and retry

Before a transaction change, inspect --dry-run. The summary shows metadata, account balances, category funds, and allocation resources before and after.
The summary explicitly reports automaticAllocation:false. Add --full to inspect the Firestore writes and preconditions.
A preview describes the current snapshots. A later command reads fresh snapshots and can produce different results.

If category availability or allocation resources change before a later saved month, transaction execution is blocked.
This covers category-only reassignment, creation, updates, and deletion, including recurring scopes.
The dry run reports executionSupported:false and summary.downstreamCarryover with existing residuals and affected months.
The CLI does not predict or write later-period amounts. Future period materialization remains unverified.
Preserve unexplained discontinuities while investigating their cause. Metadata-only and obligation-only changes retain their usual guards.

Use transactions create with frequency to create an expense, income, or card-refund series.
Supply optional repeatCount and nonWorkingDayPolicy. repeatCount includes the initial payment; null, zero, or omitted means unlimited.
A new series starts at sequenceCount 1. Ongoing series start incomplete, even when due today or earlier; omit completed or use false.
A repeatCount of 1 is valid. An already-due single-payment repeat is completed; a future one remains upcoming.
Future workday shifts preserve timezone, local time, and monthly anchors. The adjusted date selects the budget period.
Upcoming recurring entries can be periodless. Completed entries need an existing period; no missing period is created.
Creation saves one initial occurrence with obligations, indexes, and usage counts. Use the native app to complete it and generate successors.
Do not mark an ongoing new series completed or manufacture clone links to bypass this boundary.

Use transactions update for amounts, account/category assignments, payees, tags, dates, cleared status, and metadata.
For upcoming recurring entries, it also accepts frequency, repeatCount, and nonWorkingDayPolicy.
Use recurrenceScope THIS_PAYMENT for one upcoming amount/date override; THIS_AND_LATER is the default.
Existing generated occurrences require separate edits. The update command does not complete payments or generate occurrences.
Read transactions update before editing a schedule. The CLI handles workday shifts, repeat limits, and month-end anchors.

Use transactions delete --scope THIS_PAYMENT to delete one occurrence and preserve its already-generated remaining series.
An ongoing tail without a generated successor cannot use THIS_PAYMENT; the CLI cannot generate a replacement.
A finite tail whose repeat limit is exhausted can use THIS_PAYMENT.
Use --scope THIS_AND_LATER to delete the selected occurrence and its verified forward clone chain.
Earlier history remains intact. The CLI follows validated transaction links; a shared eventId does not identify a deletion chain.
Earlier nonempty clone links remain unchanged, even if their child is deleted. Do not clear these links.
Inspect the dry run's deletedTransactions, preservedTransactions, and ledger effects before committing.
Every deletion scope requires an editable canonical record with matching transaction and budget identities.

Transactions with active native allocation predicates, allocation history, or autoAllocated extras reject deletion, financial edits, and schedule edits.
Inactive allocation flags alone do not block supported edits or deletion. Updates preserve recurring clone links and never rewrite another occurrence.
Notes, color, sentiment, location, and reminder metadata remain editable within the command's other restrictions. Do not remove allocation flags or history to bypass a rejection.

Transaction commands permanently bind each live request to actor, budget, action, transaction, and original input in BEBU_HOME.
They save the exact compiled commit body before dispatch. Keep these permanent operation records.
For inspection, use transactions operation REQUEST_ID with an explicit budget.
For marker and current-version observations, use transactions recover REQUEST_ID with the same budget.
Both matching retries and recovery only observe; they never resend, including requests previously rejected.
Recovery checks at most 50 submitted document versions and reports the remaining count. These reads are not one snapshot.
Marker presence and current values do not establish an unknown outcome; native markers contain no payload hash.
Commit errors retain native error codes and preconditions in commitDiagnostic alongside local operation status.
After an authoritative rejection, review fresh state and a new dry run before using a new request ID.
For create, preserve the resolved transaction identity and date from the saved submission; inspect before creating any replacement.
For sending or unknown outcomes, keep the request identity and observe. Do not send a replacement to work around uncertainty.
Missing or corrupt local records, old untracked requests, and other installations lack the durable binding guarantee.
Local record loss and marker expiry do not authorize replay.

## Command reference

`;

const isUnlinkedPath = async (workspace: string, destination: string) => {
  let current = workspace;

  const paths = nodePath
    .relative(workspace, destination)
    .split(nodePath.sep)
    .map((component) => {
      current = nodePath.join(current, component);

      return current;
    });

  const checks = await Promise.all(
    paths.map(async (path) => {
      try {
        const entry = await lstat(path);

        return !entry.isSymbolicLink();
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return true;
        }

        throw error;
      }
    })
  );

  return checks.every(Boolean);
};

const refreshLocalSkills = async (outDir: string, files: readonly string[]) => {
  const workspace = process.cwd();
  const destination = nodePath.join(workspace, ".agents", "skills", "bebu");
  let lock;

  try {
    lock = z
      .object({
        skills: z.object({
          bebu: z.object({ source: z.string(), sourceType: z.literal("local") }),
        }),
      })
      .safeParse(JSON.parse(await readFile(nodePath.join(workspace, "skills-lock.json"), "utf-8")));
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      return;
    }

    throw error;
  }

  if (!lock.success || nodePath.resolve(workspace, lock.data.skills.bebu.source) !== outDir) {
    return;
  }

  try {
    const entry = await lstat(destination);

    if (!entry.isDirectory() || !(await isUnlinkedPath(workspace, destination))) {
      return;
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  // Refresh generated references only. The installer owns lock metadata and explicit installations.
  await Promise.all(
    files.map(async (file) => {
      const relative = nodePath.relative("bebu", file);
      const target = nodePath.join(destination, relative);

      if (await isUnlinkedPath(workspace, target)) {
        await mkdir(nodePath.dirname(target), { recursive: true });
        await writeFile(target, await readFile(nodePath.join(outDir, file)));
      }
    })
  );
};

export const generateSkills = async (app: AnyCrust, output = "skills") => {
  const outDir = nodePath.resolve(output);

  const files = await writeSkills({
    app,
    description:
      "Use for Beyond Budget sign-in, account balances, category funds, allocation diagnostics, history queries, account configuration, and transaction changes.",
    outDir,
    version: metadata.version,
  });

  await Promise.all(
    files.map(async (file) => {
      const path = nodePath.join(outDir, file);
      let content = await readFile(path, "utf-8");

      if (file.replaceAll("\\", "/") === "bebu/SKILL.md") {
        const heading = content.indexOf("\n# bebu\n");
        const table = content.indexOf("| Command | Type | Description | Documentation |");

        if (heading === -1 || table === -1) {
          throw new Error("The generated skill format changed. Update the bebu skill template");
        }

        content = `${content.slice(0, heading)}\n${skillInstructions}${content.slice(table)}`;
      } else {
        content = content.replace(
          generatedSyntaxSection,
          "## Supported syntax\n\nUse only the arguments, flags, aliases, and defaults in this reference.\nIf a feature is absent, report that the reference does not document it.\n"
        );
        content = content.replaceAll("[Skill Overview]", "[Skill overview]");
      }

      await writeFile(path, content);
    })
  );

  const metadataFile = "bebu/agents/openai.yaml";
  const metadataPath = nodePath.join(outDir, metadataFile);
  await mkdir(nodePath.dirname(metadataPath), { recursive: true });
  await writeFile(metadataPath, openaiMetadata);

  const generatedFiles = [...files, metadataFile];
  await refreshLocalSkills(outDir, generatedFiles);

  return { files: generatedFiles, outDir };
};

export const installSkills = async (
  source: string,
  workspace: string,
  agents: readonly string[] = [],
  signal?: AbortSignal
) => {
  const cli = fileURLToPath(import.meta.resolve("skills/bin/cli.mjs"));
  const targets = [...new Set(["universal", ...agents])];
  let output: string;

  try {
    const result = await executeFile(
      process.execPath,
      [
        cli,
        "add",
        nodePath.resolve(source),
        "--skill",
        "bebu",
        "--agent",
        ...targets,
        "--copy",
        "--yes",
        "--json",
      ],
      {
        cwd: workspace,
        env: { ...process.env, DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1" },
        maxBuffer: 1_000_000,
        signal,
        windowsHide: true,
      }
    );

    output = result.stdout;
  } catch {
    signal?.throwIfAborted();
    throw new Error(
      "The skill copy failed. Make sure that the package contains the bebu skill. Make sure that the destination accepts writes"
    );
  }

  return z
    .array(
      z.object({
        agents: z.array(z.string()),
        mode: z.literal("copy"),
        name: z.literal("bebu"),
        path: z.string(),
        status: z.literal("installed"),
      })
    )
    .min(1)
    .parse(JSON.parse(output));
};

export const createSkillsCommand = (getApp: () => AnyCrust) => {
  const generate = async (output: string) => await generateSkills(getApp(), output);

  return defineCommand(
    "skills",
    { description: "Generate or install the bebu agent skill" },
    (command) =>
      command
        .add(
          defineCommand(
            "generate",
            {
              description:
                "Generate references and refresh an existing managed local bebu skill copy",
            },
            (leaf) =>
              leaf
                .flags({
                  default: "skills",
                  description: "Replace this output directory. Its name must be skills",
                  name: "out",
                  type: "string",
                })
                .action(async ({ flags, stdout }) => {
                  stdout(JSON.stringify(await generate(flags.out)));
                })
          )
        )
        .add(
          defineCommand(
            "install",
            { description: "Generate and copy the bebu skill into .agents/skills in this project" },
            (leaf) =>
              leaf.action(async ({ stdout }) => {
                const generated = await generate("skills");
                const result = await installSkills(generated.outDir, process.cwd());
                stdout(JSON.stringify(result));
              })
          )
        )
  );
};
