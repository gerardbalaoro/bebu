/* oxlint-disable promise/prefer-await-to-callbacks -- Crust requires a synchronous error callback to select text or JSON output. */
import {
  Crust,
  defineArg,
  defineCommand,
  defineExtension,
  defineExtensionId,
  defineFlag,
} from "@crustjs/core";
import type { AnyCrust } from "@crustjs/core";
import { help } from "@crustjs/extensions";
import { z } from "zod";

import metadata from "../../package.json" with { type: "json" };
import { authCommand, sessionCommand } from "../auth/commands.ts";
import { AuthError } from "../auth/login.ts";
import { loadSession } from "../auth/session.ts";
import { AccountPatchSchema, AccountService } from "../budget/accounts.ts";
import { allocationAverages } from "../budget/allocation-averages.ts";
import { allocationHistory } from "../budget/allocation-history.ts";
import { allocationReport } from "../budget/allocation-report.ts";
import { previewSmartAllocation, previewTargetAllocation } from "../budget/auto-allocation.ts";
import { categoryCarryover } from "../budget/carryover.ts";
import { CategoryArchiveService } from "../budget/category-archive.ts";
import { CategoryCreationSchema, CategoryCreationService } from "../budget/category-create.ts";
import { CategoryGroupService } from "../budget/category-group.ts";
import { changeCategoryParent } from "../budget/category-hierarchy.ts";
import { StructureService } from "../budget/category-structure.ts";
import { budgetDiagnostics } from "../budget/diagnostics.ts";
import { categoryFunding } from "../budget/funding.ts";
import { LabelsSchema } from "../budget/labels.ts";
import { CategoriesSchema } from "../budget/model.ts";
import { ReallocationService } from "../budget/reallocation.ts";
import {
  removeCategoryTarget,
  saveCategoryTarget,
  TargetSettingsSchema,
} from "../budget/target-writes.ts";
import { categoryTargets } from "../budget/targets.ts";
import { HistoricalTransactionError } from "../budget/transaction-carryover.ts";
import {
  TransactionCreateSchema,
  TransactionPatchSchema,
  TransactionDeleteScopeSchema,
  TransactionDeleteSchema,
} from "../budget/transaction-model.ts";
import { TransactionOperationError } from "../budget/transaction-operations.ts";
import { ExpenseCategoryService } from "../budget/transaction-reclassify.ts";
import { TransactionService } from "../budget/transactions.ts";
import { BeyondClient } from "../firestore/client.ts";
import type { CommitOptions, CommitResult, Data } from "../firestore/encoding.ts";
import { FirestoreCommitError } from "../firestore/error.ts";
import { AllocationExecutionError, manualAllocationCommands } from "./allocation-commands.ts";
import { compactFlag, errorMessage, payload, print } from "./io.ts";
import { createSkillsCommand } from "./skills.ts";

const fullFlag = defineFlag("full", {
  description: "Include complete records or full dry-run writes",
  type: "boolean",
});

const budgetFlag = defineFlag("budget", {
  description: "Use this budget ID. The default is the selected budget in the session",
  type: "string",
});

const fileFlag = defineFlag("file", {
  description: "Read the JSON payload from this file. Use - for stdin",
  required: true,
  type: "string",
});

const dryRunFlag = defineFlag("dry-run", {
  description: "Preview all changes without a commit",
  type: "boolean",
});

const historicalCarryoverSection = {
  body: "If a transaction changes category availability or allocation resources before a later saved month, the CLI blocks execution. This includes category-only reassignments, creation, and deletion. A dry run reports executionSupported:false and summary.downstreamCarryover, with existing carryover residuals and affected months. It does not predict or write later-period amounts.\n\nUse categories carryover with an explicit budget to inspect stored cross-period residuals in a read-only snapshot. Historical policies and backend propagation remain unverified, including when residuals are zero. Future period materialization is outside this check. Preserve unexplained discontinuities and review their cause before any repair. Metadata-only and obligation-only changes remain subject to their usual guards.",
  title: "Historical carryover guard",
};

const requestFlag = defineFlag("request-id", {
  description:
    "Identify an operation with 20 letters or digits. Inspect existing requests before retrying",
  type: "string",
});

const idArg = defineArg("id", {
  description: "Use an object ID from a list command",
  required: true,
  type: "string",
});

const readFlags = [compactFlag, fullFlag, budgetFlag] as const;
const writeFlags = [...readFlags, dryRunFlag, requestFlag] as const;

const pick = (value: Data, keys: string[]): Data =>
  Object.fromEntries(keys.flatMap((key) => (value[key] === undefined ? [] : [[key, value[key]]])));

const clientFor = async (budget?: string): Promise<BeyondClient> => {
  const client = new BeyondClient(await loadSession(), { budget });
  await client.discover();

  return client;
};

const writeOptions = (flags: { "dry-run"?: boolean; "request-id"?: string }): CommitOptions => ({
  dryRun: flags["dry-run"],
  requestId: flags["request-id"],
});

const writeResult = (
  result: CommitResult | { changed: boolean; committed: boolean },
  full?: boolean
) => {
  if (!("dryRun" in result) || full === true) {
    return result;
  }

  return {
    ...result,
    affected: result.body.writes.map((write) => ({
      document: (write.update?.name ?? write.delete)?.split("/documents/")[1],
      fields: write.updateMask?.fieldPaths,
      operation: write.delete !== undefined && write.delete !== "" ? "delete" : "update",
      transforms: write.updateTransforms?.map((transform) => transform.fieldPath),
    })),
    body: undefined,
  };
};

const errorOutput = defineExtension(defineExtensionId("bebu.error-output")).onError(
  (error, { stderr, argv, commandPath }) => {
    if (
      error instanceof AllocationExecutionError ||
      error instanceof FirestoreCommitError ||
      error instanceof TransactionOperationError ||
      error instanceof HistoricalTransactionError
    ) {
      stderr(JSON.stringify({ ...error.result, error: error.message }));

      return true;
    }

    const loginError =
      (commandPath.at(-2) === "auth" && commandPath.at(-1) === "login") ||
      (argv[0] === "auth" && argv[1] === "login");

    let message = error instanceof Error ? errorMessage(error) : "Command failed";

    if (loginError && !(error instanceof AuthError)) {
      message = "Sign-in failed. Read auth login --help";
    }

    stderr(loginError ? `Error: ${message}` : JSON.stringify({ error: message }));

    return true;
  }
);

const accountsCommand = defineCommand(
  "accounts",
  { description: "Read accounts and change their configuration" },
  (command) =>
    command
      .add(
        defineCommand(
          "list",
          { description: "List account IDs and balances in integer minor units" },
          (leaf) =>
            leaf.flags(...readFlags).action(async ({ flags, stdout }) => {
              const rows = await new AccountService(await clientFor(flags.budget)).list();
              print(
                stdout,
                flags.full === true
                  ? rows
                  : rows.map((row) =>
                      pick(row, [
                        "id",
                        "name",
                        "type",
                        "balanceAmount",
                        "unclearedBalanceAmount",
                        "currencyCode",
                        "archived",
                      ])
                    ),
                flags.compact
              );
            })
        )
      )
      .add(
        defineCommand("show", { description: "Read a complete account record" }, (leaf) =>
          leaf
            .flags(...readFlags)
            .args(idArg)
            .action(async ({ args, flags, stdout }) => {
              print(
                stdout,
                await new AccountService(await clientFor(flags.budget)).show(args.id),
                flags.compact
              );
            })
        )
      )
      .add(
        defineCommand(
          "update",
          {
            description:
              "Change the account configuration. Use schema for the accepted JSON fields",
          },
          (leaf) =>
            leaf
              .flags(...writeFlags, fileFlag)
              .args(idArg)
              .action(async ({ args, flags, stdout }) => {
                const changes = await payload(flags.file, AccountPatchSchema);

                const result = await new AccountService(await clientFor(flags.budget)).update(
                  args.id,
                  changes,
                  writeOptions(flags)
                );

                print(stdout, writeResult(result, flags.full), flags.compact);
              })
        )
      )
);

const transactionRecoveryCommand = (action: "operation" | "recover") =>
  defineCommand(
    action,
    {
      description:
        action === "operation"
          ? "Inspect a durable local transaction operation"
          : "Observe a saved transaction request without resending financial writes",
      sections: [
        {
          body: "Use the original 20-character request ID and explicit budget. Keep BEBU_HOME and its permanent operation records. Recovery observes the saved marker and bounded current document versions; it never resends. A marker alone does not bind a payload or prove an unknown commit. Missing or corrupt local records remain unresolved. A known rejected attempt needs a fresh reviewed preview and a new request ID; unknown or sending attempts require observation.",
          title: "Recovery boundary",
        },
      ],
    },
    (leaf) =>
      leaf
        .flags(...readFlags)
        .args(
          defineArg("request-id", {
            description: "Original durable transaction request ID",
            required: true,
            type: "string",
          })
        )
        .action(async ({ args, flags, stdout }) => {
          const service = new TransactionService(
            new BeyondClient(await loadSession(), { budget: flags.budget })
          );

          const result =
            action === "operation"
              ? await service.operation(args["request-id"])
              : await service.recover(args["request-id"]);

          print(stdout, result, flags.compact);
        })
  );

const renameCommand = (kind: "category" | "group") =>
  defineCommand(
    "rename",
    {
      description: `Rename one ${kind} without changing financial or hierarchy fields`,
      sections: [
        {
          body: "Supports active DEFAULT records with explicit modifiable:true and matching stored identities. The name is trimmed and must contain 1–200 characters; this is a CLI limit. Preview with --dry-run; add --full for the exact name-only patch. Reads and commit use one Firestore transaction with a version precondition. Archive, creation, hierarchy changes, targets, and financial settings are separate workflows. A save marker proves request existence only; inspect the current name after an uncertain outcome before another command.",
          title: "Supported subset",
        },
      ],
    },
    (leaf) =>
      leaf
        .flags(
          ...writeFlags,
          defineFlag("name", {
            description: "New name (1–200 characters)",
            required: true,
            type: "string",
          })
        )
        .args(idArg)
        .action(async ({ args, flags, stdout }) => {
          const result = await new StructureService(await clientFor(flags.budget)).rename(
            kind,
            args.id,
            flags.name,
            writeOptions(flags)
          );

          if (flags.full === true || !("body" in result)) {
            print(stdout, result, flags.compact);

            return;
          }

          const { body, ...summary } = result;
          void body;
          print(stdout, summary, flags.compact);
        })
  );

const hierarchyCommand = (action: "attach" | "detach") =>
  defineCommand(
    action,
    {
      description:
        action === "attach"
          ? "Make an ordinary category a direct subcategory"
          : "Move an ordinary subcategory out of its parent",
      sections: [
        {
          body: "Use --parent for the intended parent on attach or expected current parent on detach. Supports active DEFAULT categories and group with explicit modifiable:true, in the same group, one level only. The source must have no children. The entire affected family must lack target, aggregation, accumulation, and computation settings and recorded links. Every account must have explicit link evidence; a family account link blocks the change. Missing category link lists are preserved without defaults. Explicit safe orders must remain unambiguous; no order is changed. Attach writes parentCategoryId and groupId; detach deletes parentCategoryId. Reads and commit share one optimistic transaction. No direct funding, history, account, target, or transaction writes occur. Parent coverage membership changes and future funding outcomes are not predicted. This does not repair carryover or enable historical transaction edits. Preview with an explicit budget and --dry-run --full. After uncertainty or marker-only confirmation, inspect categories list --full before another command; do not blindly retry. Cross-group moves, targeted or linked families, subtrees, creation, archive, and reordering remain unsupported.",
          title: "Supported subset",
        },
      ],
    },
    (leaf) =>
      leaf
        .flags(...writeFlags, {
          description:
            action === "attach"
              ? "Intended top-level parent ID in the same group"
              : "Expected current parent ID",
          name: "parent",
          required: true,
          type: "string",
        })
        .args(idArg)
        .action(async ({ args, flags, stdout }) => {
          const result = await changeCategoryParent(
            await clientFor(flags.budget),
            {
              action,
              categoryId: args.id,
              parentId: flags.parent,
            },
            writeOptions(flags)
          );

          print(stdout, writeResult(result, flags.full), flags.compact);
        })
  );

const transactionsCommand = defineCommand(
  "transactions",
  { description: "Read history and edit expenses, income, and upcoming recurring payments" },
  (command) =>
    command
      .add(transactionRecoveryCommand("operation"))
      .add(transactionRecoveryCommand("recover"))
      .add(
        defineCommand(
          "reclassify",
          {
            description:
              "Move one completed expense to another category while preserving its stored fields",
            sections: [
              {
                body: "Use explicit --budget, --from-category and --category with --dry-run --full first. This separate workflow patches only targetTo.id on the canonical transaction. It transfers signed spending, category usage counts and the existing raw category preview; existing shared previews change only targetToId. Account money, payment reserve, funding, allocation history, reconciliation, creator, version, missing fields and other transaction data are never rebuilt. Completed savings/card records require complete source/destination category caches and explicit safe source spending. A destination with one excess count is supported only when both counters agree, transaction-bound queries match every completed preview, and period and history spending are explicit; the existing difference remains. Purchases must be editable and negative. Posted REFUND records are positive; category attribution preserves the original editable flag, including false. Complete same-account/date splits of 2–20 negative expenses without a canonical parent can move one selected child while all siblings stay unchanged. Stale preview dates are corrected from the unchanged canonical timestamp and listed in correctedPreviewFields. Existing legacy fields can stay absent or null because the workflow does not interpret them. Completed recurring occurrences preserve schedule and clone links. Known DEBT references are validated and retained without debt writes. Locked non-refund records, incomplete or mixed splits, other extras and explicitly linked destination categories remain unsupported. Missing category/account link fields remain uninterpreted; explicit conflicts reject. Historical direct category effects can be saved under this bounded contract; later carryover remains a backend operation with no terminal completion receipt. propagationVerified:false is intentional. Review all accounts and later saved periods after each historical operation; do not batch uncertain changes or claim category-envelope restoration. General update/delete historical and financial guards remain unchanged. Live requests use one optimistic transaction and permanent payload-bound ownership. transactions operation/recover observes only; never replay or replace a sending/unknown request.",
                title: "Category-only workflow",
              },
            ],
          },
          (leaf) =>
            leaf
              .args(idArg)
              .flags(
                compactFlag,
                fullFlag,
                dryRunFlag,
                requestFlag,
                defineFlag("budget", {
                  description: "Explicit budget ID",
                  required: true,
                  type: "string",
                }),
                defineFlag("from-category", {
                  description: "Expected current category ID",
                  required: true,
                  type: "string",
                }),
                defineFlag("category", {
                  description: "Approved destination category ID",
                  required: true,
                  type: "string",
                })
              )
              .action(async ({ args, flags, stdout }) => {
                const result = await new ExpenseCategoryService(
                  await clientFor(flags.budget)
                ).reclassify(
                  args.id,
                  { categoryId: flags.category, fromCategoryId: flags["from-category"] },
                  writeOptions(flags)
                );

                print(stdout, writeResult(result, flags.full), flags.compact);
              })
        )
      )
      .add(
        defineCommand(
          "list",
          {
            description:
              "Read the complete history, including older records absent from the app cache",
            sections: [
              {
                body: "Legacy records retain absent fields without inferred defaults. diagnostics identifies records and fields that fail strict write validation. Invalid records appear in invalidRecords with their raw decoded data. For decoding failures, invalidRecords.fields retains the original Firestore fields and diagnostics reports decode_error. Inspect both arrays when exporting history. Missing or invalid allocation and link fields still block writes.\n\nWithout --account, follow nextPageToken until null, even when transactions is empty. Malformed records do not stop pagination. With --account, matched includes malformed records. Account queries scan at most 10,000 matches, return at most --limit readable transactions, and do not support pagination. scanLimitReached reports the scan boundary.",
                title: "Legacy records and pagination",
              },
            ],
          },
          (leaf) =>
            leaf
              .flags(
                ...readFlags,
                {
                  description: "Filter by the source or destination account ID",
                  name: "account",
                  type: "string",
                },
                {
                  default: 20,
                  description: "Return 1 to 1000 transactions",
                  name: "limit",
                  type: "number",
                },
                {
                  description: "Use the next page token from a list without an account filter",
                  name: "page-token",
                  type: "string",
                }
              )
              .action(async ({ flags, stdout }) => {
                const result = await new TransactionService(await clientFor(flags.budget)).list({
                  accountId: flags.account,
                  limit: flags.limit,
                  pageToken: flags["page-token"],
                });

                const rows =
                  flags.full === true
                    ? result.transactions
                    : result.transactions.map((transaction) => ({
                        ...pick(transaction, [
                          "id",
                          "type",
                          "amount",
                          "completed",
                          "cleared",
                          "dueAt",
                          "frequency",
                          "notes",
                          "repeatCount",
                          "sequenceCount",
                        ]),
                        fromId: transaction.targetFrom?.id,
                        toId: transaction.targetTo?.id,
                      }));

                print(stdout, { ...result, transactions: rows }, flags.compact);
              })
        )
      )
      .add(
        defineCommand(
          "show",
          {
            description: "Read a complete transaction record",
            sections: [
              {
                body: "Returns the stored decoded record, including absent legacy fields and explicit null creator values. Reads do not add write defaults. Financial writes still require strict validation. Use transactions list diagnostics to inspect strict-validation failures.",
                title: "Legacy records",
              },
            ],
          },
          (leaf) =>
            leaf
              .flags(...readFlags)
              .args(idArg)
              .action(async ({ args, flags, stdout }) => {
                const transactionResult = await new TransactionService(
                  await clientFor(flags.budget)
                ).transaction(args.id);

                print(stdout, transactionResult.data, flags.compact);
              })
        )
      )
      .add(
        defineCommand(
          "create",
          {
            description:
              "Create one-off or recurring expenses, income, and card refunds without automatic allocation",
            sections: [
              {
                body: 'Supply frequency, optional repeatCount, and optional nonWorkingDayPolicy in the create JSON. frequency defaults to ONE_OFF. Supported repeats are DAILY, WEEKLY, FORTNIGHTLY, FOUR_WEEKLY, MONTHLY, TWO_MONTHLY, QUARTERLY, HALF_YEARLY, ANNUALLY, and BIENNIALLY. Workday policies are KEEP_ORIGINAL_DATE (default), SHIFT_TO_NEXT_AVAILABLE_WORKDAY, and SHIFT_TO_PREVIOUS_AVAILABLE_WORKDAY. For example: {"accountId":"cashId","categoryId":"subscriptionId","amountMinor":15000,"dueAt":"2030-01-31T09:00:00+08:00","timezone":"Asia/Manila","frequency":"MONTHLY","repeatCount":12}. Preview with transactions create --file transaction.json --dry-run; add --full for exact writes.\n\nA new series starts at sequenceCount 1. repeatCount is the total number of payments; omitted, null, or zero means unlimited. A limit of 1 is valid on creation. Ongoing series start incomplete, even when due today or earlier. Omit completed or supply false. A single-payment repeat already due is completed; future single-payment repeats remain upcoming. The CLI uses the due timestamp to determine whether that single payment is due.\n\nFuture workday shifts preserve local time, the original date offset, and monthly anchors. DAILY workday repeats shift forward. The adjusted due date selects its saved period. Upcoming entries can be periodless; completed entries require an existing period. Upcoming expenses affect only obligations, indexes, and usage counts. No completed balance, spending, payment-reserve, history, or allocation effects occur until completion.\n\nCreation saves one initial canonical entry and its indexes atomically. It does not generate later occurrences or complete an ongoing payment. Use the native app for completion and occurrence generation. One-off entries cannot have a finite repeat limit or a workday-shift policy. Automatic allocation remains disabled.',
                title: "Recurring transactions",
              },
              historicalCarryoverSection,
              {
                body: 'Use type OUTFLOW for a purchase or REFUND for a credit-card refund. amountMinor is always positive. A refund requires accountId for the card and categoryId for an ordinary expense category. For example: {"type":"REFUND","accountId":"cardId","categoryId":"groceriesId","amountMinor":12500,"dueAt":"2026-10-01T12:00:00+08:00"}. The stored refund is a positive OUTFLOW with subtype REFUND. Expense categories linked to other accounts require the native app.\n\nCard purchases can overspend a category. Both spending and the linked payment category reserve change by the full purchase amount; refunds reverse those movements. This does not allocate cash to cover overspending. An uncleared entry changes only the uncleared account balance; clearing moves it into the cleared balance and account history. Expense-category spending changes regardless of clearing.\n\nHistorical dueAt timestamps are preserved. Completed entries and one-off creation require a saved budget period; the historical carryover guard also applies. History uses the due-date month in the CLI runtime timezone. Use --dry-run to inspect balances, spending, and reserves; add --full for exact writes.',
                title: "Card purchases and refunds",
              },
              {
                body: "New refunds are saved with editable:false, matching the native refund flow. Creation previews show editable in the transaction summary. The CLI rejects later updates or deletion of these records. Existing stored flags remain unchanged.",
                title: "Refund editability",
              },
            ],
          },
          (leaf) =>
            leaf.flags(...writeFlags, fileFlag).action(async ({ flags, stdout }) => {
              const input = await payload(flags.file, TransactionCreateSchema);

              const result = await new TransactionService(await clientFor(flags.budget)).create(
                input,
                writeOptions(flags)
              );

              print(stdout, writeResult(result, flags.full), flags.compact);
            })
        )
      )
      .add(
        defineCommand(
          "update",
          {
            description: "Edit transaction amounts, details, dates, and upcoming recurrence rules",
            sections: [
              {
                body: "Use schema for the complete transactionUpdate payload. amountMinor is a positive integer; the CLI preserves the purchase, refund, or income sign. Editable fields include accountId, categoryId, payeeId (null removes it), tagIds ([] removes all), dueAt, timezone, notes, color, cleared, sentiment, location, and reminder details. Balances, history, indexes, and usage counts change atomically.",
                title: "Editable fields",
              },
              historicalCarryoverSection,
              {
                body: "Upcoming entries also accept frequency, repeatCount, and nonWorkingDayPolicy. repeatCount is a total sequence limit; null or zero means unlimited. A positive limit is at least sequenceCount + 1. Changing frequency resets sequenceCount to 1 and repeatCount to unlimited unless a new limit is supplied.\n\nFor an upcoming recurring amount or date edit, recurrenceScope selects THIS_PAYMENT or THIS_AND_LATER (default). THIS_PAYMENT preserves the series baseline for later payments. Resubmitting the current amount or date with THIS_AND_LATER also replaces its future baseline. Only the selected canonical entry changes; already-created occurrences require separate edits.\n\ndueAt accepts an ISO timestamp with an explicit offset. The CLI keeps its time of day and calculates dates in the stored transaction timezone, or the supplied timezone. Weekend policies adjust future dates and retain their original schedule anchors. DAILY workday repeats always shift forward. Upcoming months without saved periods remain periodless. This command does not complete payments or generate occurrences.",
                title: "Recurring payments",
              },
              {
                body: "Financial and schedule edits support editable, unreconciled expenses, card refunds, and income without splits, files, or active native allocation effects. Recurring clone links and inactive allocation flags are preserved. Actual linked-allocation predicates, allocation history, and autoAllocated extras remain guarded. Account and category links must agree. Expense categories linked to other accounts require the native app. Foreign-currency ledgers require the app. Completed entries cannot change recurrence rules or move to future dates. A completed entry needs an existing destination budget period. Notes, color, sentiment, location, and reminder metadata remain editable within the record's other restrictions.\n\nInspect --dry-run before committing. The summary includes old and new accounts, category funds, monthly obligations, and allocation resources. Add --full for exact writes and version preconditions.",
                title: "Restrictions",
              },
            ],
          },
          (leaf) =>
            leaf
              .flags(...writeFlags, fileFlag)
              .args(idArg)
              .action(async ({ args, flags, stdout }) => {
                const changes = await payload(flags.file, TransactionPatchSchema);

                const result = await new TransactionService(await clientFor(flags.budget)).update(
                  args.id,
                  changes,
                  writeOptions(flags)
                );

                print(stdout, writeResult(result, flags.full), flags.compact);
              })
        )
      )
      .add(
        defineCommand(
          "delete",
          {
            description:
              "Delete one occurrence or a verified recurring chain with atomic ledger reversal",
            sections: [
              {
                body: "Recurring deletion requires --scope THIS_PAYMENT or --scope THIS_AND_LATER. THIS_PAYMENT deletes the selected occurrence and preserves already-generated successors. THIS_AND_LATER deletes the selected occurrence and every validated forward clone-linked occurrence, including completed entries and upcoming obligations. Earlier occurrences and their nonempty clone links remain unchanged. A one-off transaction defaults to a single deletion.\n\nExample: bebu transactions delete <id> --scope THIS_AND_LATER --dry-run. Inspect deletedTransactions, preservedTransactions, account balances, category funds, payment reserves, and allocation resources. Add --full for exact atomic writes and version preconditions.\n\nMembership follows canonical clonedToTransactionId links. eventId never selects records. Budget identity, consecutive sequence numbers, increasing dates, frequency, timezone, account/category targets, payee, notes, type, and subtype must agree at each boundary. A broken link, cycle, branch, incompatible boundary, missing dependency, or active allocation effect rejects the entire plan.",
                title: "Deletion scopes",
              },
              historicalCarryoverSection,
              {
                body: "Every deletion scope requires an editable canonical record whose transaction and budget IDs match the selected document.",
                title: "Eligibility",
              },
              {
                body: "A live recurring tail without a generated successor cannot use THIS_PAYMENT unless its finite repeat limit is exhausted. The CLI cannot generate a replacement; use THIS_AND_LATER only when you intend to stop the series. Preserved predecessor clone links may point to a deleted record, matching native single-record deletion and preserving earlier completion classification. Do not clear these links.\n\nCompleted deletions reverse the saved account, spending, reserve, history, index, and counter effects. Upcoming deletions remove obligations and usage counts; periodless entries remain periodless. Supported reminder documents and index entries are removed in the same commit. Native allocation predicates, allocation history, autoAllocated extras, reconciliation, splits, files, foreign-currency ledgers, and unsupported linked-account flows remain guarded.\n\nThe CLI inspects at most 100 linked occurrences and rejects plans beyond its atomic write/size limits. Reads and predecessor queries use one Firestore snapshot; concurrent changes fail rather than trigger automatic retries. No event-based sweep, recurrence conversion, zero-amount rewrite, or synthetic successor occurs. Backend regeneration has not been established by the saved client artifact.",
                title: "Limits and safety",
              },
            ],
          },
          (leaf) =>
            leaf
              .flags(...writeFlags, {
                description:
                  "Delete THIS_PAYMENT or THIS_AND_LATER; required for recurring entries",
                name: "scope",
                type: "string",
              })
              .args(idArg)
              .action(async ({ args, flags, stdout }) => {
                const result = await new TransactionService(await clientFor(flags.budget)).delete(
                  args.id,
                  {
                    ...writeOptions(flags),
                    scope:
                      flags.scope === undefined
                        ? undefined
                        : TransactionDeleteScopeSchema.parse(flags.scope),
                  }
                );

                print(stdout, writeResult(result, flags.full), flags.compact);
              })
        )
      )
);

const fundingCommand = defineCommand(
  "funding",
  {
    description: "Read category funds for one month in integer minor units",
    sections: [
      {
        body: "Available funds equal allocatedAmount + carriedOverAmount + otherAmount - spentAmount. upcomingAmount is separate. Missing amount fields count as zero. Categories without a balance have zero funds. Balance IDs absent from the category index remain visible.\n\nAccount balances describe account money. Category funds describe its budget assignment. This query does not calculate ready-to-allocate funds or parent totals.",
        title: "Funding amounts",
      },
    ],
  },
  (command) =>
    command
      .flags(
        ...readFlags,
        {
          description: "Select an existing budget month in YYYY-MM format",
          name: "month",
          required: true,
          type: "string",
        },
        { description: "Return only this category ID", name: "category", type: "string" }
      )
      .action(async ({ flags, stdout }) => {
        const result = await categoryFunding(
          await clientFor(flags.budget),
          flags.month,
          flags.category
        );

        print(stdout, result, flags.compact);
      })
);

const budgetCommand = defineCommand(
  "budget",
  { description: "Read budget diagnostics" },
  (command) =>
    command.add(
      defineCommand(
        "diagnostics",
        {
          description:
            "Read stored account/category links and allocation settings with their source paths",
          sections: [
            {
              body: "This command reads the budget, user, accounts index, and categories index. It returns stored link fields, config objects, and recognized allocation setting names. Values remain raw, including unknown enums and conflicting links. An absent field has no inferred default. The output does not establish native behavior or list every possible setting.",
              title: "Observed fields",
            },
          ],
        },
        (leaf) =>
          leaf.flags(...readFlags).action(async ({ flags, stdout }) => {
            print(stdout, await budgetDiagnostics(await clientFor(flags.budget)), flags.compact);
          })
      )
    )
);

const allocationsCommand = defineCommand(
  "allocations",
  { description: "Plan and save manual allocations, inspect history, or preview target funding" },
  (command) =>
    command
      .add(...manualAllocationCommands)
      .add(
        defineCommand(
          "reallocate",
          {
            description:
              "Move category funds with one native reallocation transaction and history entry",
            sections: [
              {
                body: "Use an explicit budget, source, destination, positive minor-unit amount, month and native device calculation timezone. The timezone must match the CLI runtime. Preview --dry-run --full first. Supports only the latest saved month, current or future, ordinary flat unlinked categories with explicit ALL carryover and no targets or coverage strategies. Every consumed financial amount, allocation history value, link and counter must be explicit. All four indexes must be small, complete and explicitly untrimmed. Missing values block execution without defaults. Source availability must cover the transfer. The CLI atomically saves the native transaction, both allocations, four preview indexes, counters, category histories and the root MONEY_REALLOCATION history entry. This consolidates the native app's two save boundaries. No manual allocation, account money, pool resources or carryover is written. Historical propagation and future period materialization remain unsupported. Inspect the preview before committing; live commands read fresh state. Permanent transaction operation records bind the request before dispatch. Use transactions operation/recover with the original request ID after uncertainty; neither retry nor recovery resends. Marker/current-value observations cannot prove a lost acknowledgment. Keep BEBU_HOME. Undo, deletion, linked categories, hierarchy, large/trimmed indexes and the held migration discrepancy remain unsupported.",
                title: "Supported subset",
              },
            ],
          },
          (leaf) =>
            leaf
              .flags(
                ...writeFlags,
                { description: "Source category ID", name: "from", required: true, type: "string" },
                {
                  description: "Destination category ID",
                  name: "to",
                  required: true,
                  type: "string",
                },
                {
                  description: "Positive transfer amount in integer minor units",
                  name: "amount-minor",
                  required: true,
                  type: "number",
                },
                {
                  description: "Latest saved YYYY-MM month",
                  name: "month",
                  required: true,
                  type: "string",
                },
                {
                  description: "Native device timezone, matching the CLI runtime timezone",
                  name: "calculation-timezone",
                  required: true,
                  type: "string",
                }
              )
              .action(async ({ flags, stdout }) => {
                const result = await new ReallocationService(
                  await clientFor(flags.budget)
                ).reallocate(
                  {
                    amountMinor: flags["amount-minor"],
                    calculationTimezone: flags["calculation-timezone"],
                    from: flags.from,
                    month: flags.month,
                    to: flags.to,
                  },
                  writeOptions(flags)
                );

                print(stdout, writeResult(result, flags.full), flags.compact);
              })
        )
      )
      .add(
        defineCommand(
          "preview",
          {
            description: "Calculate target or restricted smart funding without changing the budget",
            sections: [
              {
                body: "Use --strategy targets (default) for ongoing savings, monthly spending, and SAVINGS targets. SAVINGS requires a stored creation timestamp and --calculation-timezone set to the native app device timezone. Fixed, dynamic, and no-deadline demands are supported; repeating targets and deadlines before creation are rejected. No target forecast or progress percentage is calculated.\n\nUse --strategy smart to cover overspending before supported targets. Smart requires an untrimmed, empty upcoming transaction map and zero upcoming balances. It supports positive monthly spending and ongoing savings targets, or overspending without a target. Nonpositive target amounts are rejected. Snoozed targets, FUND_OVERRUNS, and SAVINGS are rejected in smart mode. Any positive funding suppresses later phases, including partial funding.\n\nBoth strategies require a flat zero-based budget, the current/latest saved month, and an explicit saved user timezone for the current-month check. Hierarchies, archived or special categories, linked accounts, ambiguous order, and ignoring available funds are rejected. Results include source versions, pool operands, and proposed amounts. Reads are not one atomic snapshot. executionSupported is false: this command cannot save the plan. Do not convert its output into manual document writes.",
                title: "Supported preview",
              },
            ],
          },
          (leaf) =>
            leaf
              .flags(
                ...readFlags,
                {
                  description: "Select the current/latest saved YYYY-MM budget month",
                  name: "month",
                  required: true,
                  type: "string",
                },
                {
                  default: "targets",
                  description: "Choose targets or smart",
                  name: "strategy",
                  type: "string",
                },
                {
                  description:
                    "Native app device timezone for SAVINGS dates, for example Asia/Manila",
                  name: "calculation-timezone",
                  type: "string",
                }
              )
              .action(async ({ flags, stdout }) => {
                const strategy = z.enum(["targets", "smart"]).parse(flags.strategy);
                const calculationTimezone = flags["calculation-timezone"];

                if (strategy === "smart" && calculationTimezone !== undefined) {
                  throw new Error("--calculation-timezone applies to target previews only");
                }

                if (calculationTimezone !== undefined) {
                  new Intl.DateTimeFormat("en-US", { timeZone: calculationTimezone }).format();
                }

                const client = await clientFor(flags.budget);

                const result =
                  strategy === "smart"
                    ? await previewSmartAllocation(client, flags.month)
                    : await previewTargetAllocation(client, flags.month, new Date(), {
                        calculationTimezone,
                      });

                print(stdout, result, flags.compact);
              })
        )
      )
      .add(
        defineCommand(
          "averages",
          {
            description: "Read average allocation and spending from prior saved months",
            sections: [
              {
                body: "Select a reference month with --before and one or three saved periods with --periods. The query uses the latest saved periods before that month, even when calendar months are absent. It averages only positive values and truncates fractional minor units. Results include orphan category IDs, contributing period counts, and source versions. This is a history query. It does not execute historical auto-allocation or calculate replacement effects.",
                title: "History basis",
              },
            ],
          },
          (leaf) =>
            leaf
              .flags(
                ...readFlags,
                {
                  description: "Use saved periods before this YYYY-MM month",
                  name: "before",
                  required: true,
                  type: "string",
                },
                {
                  default: 3,
                  description: "Use 1 or 3 saved periods",
                  name: "periods",
                  type: "number",
                }
              )
              .action(async ({ flags, stdout }) => {
                print(
                  stdout,
                  await allocationAverages(
                    await clientFor(flags.budget),
                    flags.before,
                    flags.periods
                  ),
                  flags.compact
                );
              })
        )
      )
      .add(
        defineCommand(
          "history",
          {
            description: "Read native allocation history, optionally with matching transactions",
            sections: [
              {
                body: "Entries retain their raw source, amount fields, map key, and stored ID. Rows use ascending map-key order. --transactions looks up both candidate IDs in canonical transactions; unmatched entries remain visible. A history entry does not establish the complete financial effects of its operation. Reads include document versions but are not one atomic snapshot.",
                title: "History scope",
              },
            ],
          },
          (leaf) =>
            leaf
              .flags(
                ...readFlags,
                {
                  description: "Filter by an existing YYYY-MM budget month",
                  name: "month",
                  type: "string",
                },
                {
                  description: "Match categoryId or linkedCategoryId",
                  name: "category",
                  type: "string",
                },
                {
                  description: "Look up canonical transactions associated by map key or stored ID",
                  name: "transactions",
                  type: "boolean",
                }
              )
              .action(async ({ flags, stdout }) => {
                print(
                  stdout,
                  await allocationHistory(await clientFor(flags.budget), {
                    categoryId: flags.category,
                    includeTransactions: flags.transactions,
                    yearMonth: flags.month,
                  }),
                  flags.compact
                );
              })
        )
      )
      .add(
        defineCommand(
          "report",
          {
            description: "Summarize monthly allocations by category and nature",
            sections: [
              {
                body: "The total includes negative allocations. Whole-number percentages use the sum of positive category allocations, with negative contributions shown as zero percent. The report includes orphan balances and retains unknown natures. This calculation matches the inspected native example; complete native report parity is not established. This is not a ready-to-allocate balance.",
                title: "Percentage basis",
              },
            ],
          },
          (leaf) =>
            leaf
              .flags(...readFlags, {
                description: "Select an existing YYYY-MM budget month",
                name: "month",
                required: true,
                type: "string",
              })
              .action(async ({ flags, stdout }) => {
                print(
                  stdout,
                  await allocationReport(await clientFor(flags.budget), flags.month),
                  flags.compact
                );
              })
        )
      )
);

const monthlySpendingTargetCommand = (action: "create" | "update") =>
  defineCommand(
    action,
    {
      description: `${action === "create" ? "Create" : "Edit"} a positive monthly spending target`,
      sections: [
        {
          body: "Supports active DEFAULT categories with explicit modifiable:true and no parent or children. Both --amount-minor and --carry-over are required. The carry-over setting belongs to target demand; it does not change category carryover. Creation requires an absent target field and uses the current creation timestamp. Update requires a complete known SPENDING/MONTHLY target with a native whole-second timestamp. Like the native spending editor, changed settings renew createdAt from the current clock. Unknown fields, schedules, snoozes, savings targets, and hierarchy are rejected. The complete target is serialized and replaced under one snapshot version precondition. No funds, account, history, or transaction documents are directly changed; future target demand and automatic funding suggestions change. After an uncertain outcome or marker-only confirmation, inspect targets list before another command; do not blindly retry.",
          title: "Supported subset",
        },
      ],
    },
    (leaf) =>
      leaf
        .flags(
          ...writeFlags,
          {
            description: "Positive safe integer target amount in minor units",
            name: "amount-minor",
            required: true,
            type: "number",
          },
          {
            description: "Explicit target carryover policy: ALL or NONE",
            name: "carry-over",
            required: true,
            type: "string",
          }
        )
        .args(idArg)
        .action(async ({ args, flags, stdout }) => {
          const result = await saveCategoryTarget(
            await clientFor(flags.budget),
            args.id,
            action,
            TargetSettingsSchema.parse({
              amountMinor: flags["amount-minor"],
              carryOverStrategy: flags["carry-over"],
            }),
            writeOptions(flags)
          );

          print(stdout, writeResult(result, flags.full), flags.compact);
        })
  );

const targetsCommand = defineCommand(
  "targets",
  { description: "Inspect, create, edit, or remove supported monthly spending targets" },
  (command) =>
    command
      .add(monthlySpendingTargetCommand("create"))
      .add(monthlySpendingTargetCommand("update"))
      .add(
        defineCommand(
          "remove",
          {
            description: "Remove a monthly spending target without changing stored funding",
            sections: [
              {
                body: "Supports explicit positive SPENDING/MONTHLY targets on active DEFAULT categories with modifiable:true and no parent or children. Raw account links remain untouched and are not interpreted. Preview with --dry-run and an explicit budget. The complete target is deleted under a snapshot version precondition. Existing category funds, history, account money, and other settings are not directly changed. Future target demand and automatic funding suggestions intentionally change. Savings/repeating targets and hierarchical categories require separate workflows.",
                title: "Supported subset",
              },
            ],
          },
          (leaf) =>
            leaf
              .flags(...writeFlags)
              .args(idArg)
              .action(async ({ args, flags, stdout }) => {
                const result = await removeCategoryTarget(
                  await clientFor(flags.budget),
                  args.id,
                  writeOptions(flags)
                );

                print(stdout, writeResult(result, flags.full), flags.compact);
              })
        )
      )
      .add(
        defineCommand(
          "list",
          {
            description: "Read target settings separately from category funds",
            sections: [
              {
                body: "Target settings remain raw, including unknown types and snooze settings. An optional month includes the stored balance. Availability is null when required balance fields are absent. Target progress is not calculated and must not be inferred from category availability.",
                title: "Target progress",
              },
            ],
          },
          (leaf) =>
            leaf
              .flags(
                ...readFlags,
                {
                  description: "Include funds from an existing YYYY-MM budget month",
                  name: "month",
                  type: "string",
                },
                {
                  description: "Return the target for this category ID",
                  name: "category",
                  type: "string",
                }
              )
              .action(async ({ flags, stdout }) => {
                print(
                  stdout,
                  await categoryTargets(await clientFor(flags.budget), {
                    categoryId: flags.category,
                    yearMonth: flags.month,
                  }),
                  flags.compact
                );
              })
        )
      )
);

export const createApp = (): AnyCrust => {
  const app: AnyCrust = new Crust("bebu", {
    description: metadata.description,
    sections: [
      {
        body: "Run once:\n  npx --yes github:gerardbalaoro/bebu <command>\n\nInstall globally:\n  npm install -g https://github.com/gerardbalaoro/bebu\n\nInstall the skill for your agent:\n  npx --yes skills add gerardbalaoro/bebu --skill bebu",
        title: "Install or run once",
      },
      {
        body: "Run bebu auth login.\n\nTo reuse your Chrome session (Chrome 144+):\n1. Enable chrome://inspect/#remote-debugging.\n2. Approve the connection prompt.\n3. If the app requires sign-in, sign in.\n4. Open your budget.\n\nbebu opens a separate app window in your Chrome profile. It closes that window after login. Your other tabs stay open.\n\nFor a separate saved browser profile, use auth login --fresh.\n\nThe auth status command shows the connection state. The auth logout command deletes local credentials and the separate bebu profile. Your Chrome profile stays intact.\n\nData commands use direct requests to Firestore. The session import and session prepare commands can reuse an agent browser.\n\nBEBU_HOME selects the bebu data folder. BEBU_BROWSER selects the browser executable for the separate profile.",
        title: "Browser session",
      },
      {
        body: "Before a change:\n1. Use schema to find the accepted JSON fields.\n2. Use --dry-run to inspect transaction amounts before and after the change. Add --full to inspect all writes.\n\nAmounts use integer minor units (PHP centavos). bebu creates one-off or recurring expenses, income, and card refunds (type REFUND with a positive amountMinor and expense categoryId). Use frequency, repeatCount, and nonWorkingDayPolicy to create a recurring series. Read transactions create --help for completion and period rules. Updates also support existing upcoming recurring payments. Recurring deletion requires an explicit --scope; read transactions delete --help and inspect its dry run. Transfers, splits, debts, files, reconciliation, and active linked allocation effects require separate flows. For manual allocations, use allocations set --dry-run followed by allocations apply with the saved plan and an explicit request ID. Card purchases can overspend a category; the full purchase amount changes spending and the payment reserve without allocating funds. Refunds reverse those effects. Historical dates are retained.\n\nTransaction updates accept amounts, accounts, categories, payees, tags, dates, cleared status, and metadata. Upcoming entries also accept recurrence rules. Read transactions update --help for scope and restrictions. The --request-id flag identifies the atomic commit and its save marker.\n\nTransaction commands permanently bind request IDs to actor, budget, action, and original input in local operation records. An existing request only observes; it never resends. Keep BEBU_HOME and its records. A new operation needs a new request ID. Native save markers do not bind payloads; old or cross-device requests lack this local recovery guarantee.",
        title: "Write rules",
      },
      historicalCarryoverSection,
      {
        body: "Transaction commands save the original intent, exact compiled body, and outcome under BEBU_HOME before dispatch. Use transactions operation REQUEST_ID to inspect a local record and transactions recover REQUEST_ID to observe its marker and up to 50 current document versions. Recovery never resends, including rejected requests. Marker presence and current values do not establish an unknown commit outcome. Native error codes and preconditions remain in commitDiagnostic.\n\nAfter an authoritative rejection, read fresh state and review a new dry run before creating a new request ID. Preserve the intended transaction identity; for create, inspect the resolved ID and date in the saved submission rather than generating a replacement blindly. Sending or unknown outcomes require observation. Missing or corrupt local records and untracked old or cross-device requests remain unresolved; preserve existing data and do not blindly replay them.",
        title: "Commit recovery",
      },
    ],
    version: metadata.version,
  })
    .extend(help(), errorOutput)
    .add(
      authCommand,
      sessionCommand,
      accountsCommand,
      transactionsCommand,
      budgetCommand,
      allocationsCommand,
      targetsCommand
    )
    .add(
      defineCommand(
        "categories",
        { description: "Read categories and create or change supported ordinary categories" },
        (command) =>
          command
            .add(
              defineCommand(
                "archive",
                {
                  description:
                    "Archive an ordinary category while preserving its financial history",
                  sections: [
                    {
                      body: "Requires an explicit budget and current --month in the saved user timezone. Review --dry-run --full first. Supports childless active modifiable DEFAULT categories and groups, no target or explicit account links, and no canonical, category/global stash upcoming references or templates. Canonical reference queries are snapshot-bound and each must contain fewer than 10000 records. Absent account link fields remain uninterpreted and unchanged. The native metadata patch sets archived:true and the current archivedAt timestamp, and deletes parentCategoryId. Historical transactions, allocations, money and periods are untouched. No funding amount is evaluated or defaulted: independently review and move remaining category funds before archiving. The unchanged native template rewrite is omitted after snapshot validation. Reads and commit share one optimistic transaction. Permanent operations bind the exact archive intent and compiled body before dispatch; an existing request never resends. After uncertainty use transactions operation/recover with the original request ID, never replace or replay it. Archive hides the category from the current month onward; this is not deletion or funding repair. Other category lifecycle workflows remain separate.",
                      title: "Supported subset",
                    },
                  ],
                },
                (leaf) =>
                  leaf
                    .args(idArg)
                    .flags(
                      compactFlag,
                      fullFlag,
                      dryRunFlag,
                      requestFlag,
                      defineFlag("budget", {
                        description: "Explicit budget ID",
                        required: true,
                        type: "string",
                      }),
                      defineFlag("month", {
                        description: "Current month YYYY-MM in the saved user timezone",
                        required: true,
                        type: "string",
                      })
                    )
                    .action(async ({ args, flags, stdout }) => {
                      const result = await new CategoryArchiveService(
                        await clientFor(flags.budget)
                      ).archive({ categoryId: args.id, month: flags.month }, writeOptions(flags));

                      print(stdout, writeResult(result, flags.full), flags.compact);
                    })
              )
            )
            .add(
              defineCommand(
                "create",
                {
                  description: "Create one ordinary category and its empty stash atomically",
                  sections: [
                    {
                      body: "Requires an explicit budget, name, group, icon and color. Choose icon/color codes from categories list --full. Only ordinary zero-based budgets without a challenge and active modifiable DEFAULT groups are supported. The nonempty selected group must be flat, with explicit unique safe peer orders. The command appends after the highest order and rejects duplicate names. It creates the native DEFAULT/ALL/UNCATEGORIZED category with no account links, target or parent, plus an empty CATEGORY stash. Existing financial records are untouched; no missing financial amounts are assigned. Review --dry-run --full. Live execution reads fresh state and binds the exact generated identity and commit body to permanent operation records. Use transactions operation/recover with the original request ID after uncertainty; never replay or replace it. Group creation, empty groups, other policies, hierarchy, funding and historical transaction edits remain unsupported. Native creation evidence and deployed disposable-lab CLI saves establish this subset. The original complete acknowledgment and full document comparisons confirm the creation envelope and preservation of existing records.",
                      title: "Supported subset",
                    },
                  ],
                },
                (leaf) =>
                  leaf
                    .flags(
                      compactFlag,
                      fullFlag,
                      dryRunFlag,
                      requestFlag,
                      defineFlag("budget", {
                        description: "Explicit budget ID",
                        required: true,
                        type: "string",
                      }),
                      defineFlag("name", {
                        description: "New category name",
                        required: true,
                        type: "string",
                      }),
                      defineFlag("group", {
                        description: "Existing ordinary group ID",
                        required: true,
                        type: "string",
                      }),
                      defineFlag("icon", {
                        description: "Icon code from an existing category",
                        required: true,
                        type: "string",
                      }),
                      defineFlag("color", {
                        description: "Color code from an existing category",
                        required: true,
                        type: "string",
                      })
                    )
                    .action(async ({ flags, stdout }) => {
                      const result = await new CategoryCreationService(
                        await clientFor(flags.budget)
                      ).create(
                        {
                          color: flags.color,
                          groupId: flags.group,
                          icon: flags.icon,
                          name: flags.name,
                        },
                        writeOptions(flags)
                      );

                      print(stdout, writeResult(result, flags.full), flags.compact);
                    })
              )
            )
            .add(renameCommand("category"))
            .add(
              defineCommand(
                "move",
                {
                  description: "Append one ordinary category to a later group",
                  sections: [
                    {
                      body: "Review --dry-run --full with explicit --budget, --from-group and --group. The source must be an active modifiable DEFAULT category without a parent, children, target or stored account links. Both groups must be active modifiable DEFAULT groups with explicit native integer orders. The destination must follow the source group and be nonempty and flat. Affected peers need explicit unique nonnegative native integer orders. Every account must have a matching identity and an explicit category link field excluding the source. Missing account-link evidence rejects execution. The command patches only groupId/order, appending after the highest destination order. Other settings, absent fields, transaction identities and amounts remain unchanged. Grouped reports and future funding behavior can change. Live requests bind a permanent local request ID to their intent and exact body; only a complete original acknowledgment establishes success. Unknown/sending outcomes must never be replayed or replaced. Inspect with transactions operation/recover and retain BEBU_HOME. Reverse moves, subtrees, linked/targeted sources, empty destinations, and peer normalization remain unsupported.",
                      title: "Bounded append move",
                    },
                  ],
                },
                (leaf) =>
                  leaf
                    .args(
                      defineArg("id", {
                        description: "Category ID",
                        required: true,
                        type: "string",
                      })
                    )
                    .flags(
                      compactFlag,
                      fullFlag,
                      dryRunFlag,
                      requestFlag,
                      defineFlag("budget", {
                        description: "Explicit budget ID",
                        required: true,
                        type: "string",
                      }),
                      defineFlag("from-group", {
                        description: "Expected current group ID",
                        required: true,
                        type: "string",
                      }),
                      defineFlag("group", {
                        description: "Destination group ID",
                        required: true,
                        type: "string",
                      })
                    )
                    .action(async ({ args, flags, stdout }) => {
                      const result = await new CategoryGroupService(
                        new BeyondClient(await loadSession(), { budget: flags.budget })
                      ).move(
                        {
                          categoryId: args.id,
                          fromGroupId: flags["from-group"],
                          groupId: flags.group,
                        },
                        writeOptions(flags)
                      );

                      print(stdout, writeResult(result, flags.full), flags.compact);
                    })
              )
            )
            .add(hierarchyCommand("attach"))
            .add(hierarchyCommand("detach"))
            .add(fundingCommand)
            .add(
              defineCommand(
                "carryover",
                {
                  description:
                    "Audit stored category carryover across saved months without financial writes",
                  sections: [
                    {
                      body: "Compare consecutive saved months under each category's explicit current ALL policy. A signed residual is stored next-month carryover minus prior raw available funds. Discontinuities are observations; they do not establish an incorrect baseline or authorize repairs. Missing amounts, unsupported policies, special categories, and calendar gaps remain unknown. No missing financial amount becomes zero. Historical policy and backend propagation remain unverified, even when residuals are zero. Reads use one read-only Firestore snapshot.",
                      title: "Interpretation",
                    },
                  ],
                },
                (leaf) =>
                  leaf
                    .flags(
                      ...readFlags,
                      { description: "Inspect one category ID", name: "category", type: "string" },
                      {
                        description: "Start at this saved YYYY-MM month",
                        name: "from-month",
                        type: "string",
                      },
                      {
                        description: "End at this saved YYYY-MM month",
                        name: "through-month",
                        type: "string",
                      }
                    )
                    .action(async ({ flags, stdout }) => {
                      print(
                        stdout,
                        await categoryCarryover(await clientFor(flags.budget), {
                          categoryId: flags.category,
                          fromMonth: flags["from-month"],
                          throughMonth: flags["through-month"],
                        }),
                        flags.compact
                      );
                    })
              )
            )
            .add(
              defineCommand("list", { description: "List category IDs and types" }, (leaf) =>
                leaf.flags(...readFlags).action(async ({ flags, stdout }) => {
                  const clientForResult = await clientFor(flags.budget);

                  const stashResult = await clientForResult.stash(
                    "GROUPS_AND_CATEGORIES",
                    CategoriesSchema
                  );

                  const rows = Object.values(stashResult.data.data.categories);
                  print(
                    stdout,
                    flags.full === true
                      ? rows
                      : rows.map((row) => pick(row, ["id", "name", "type", "groupId", "archived"])),
                    flags.compact
                  );
                })
              )
            )
      )
    )
    .add(
      defineCommand(
        "groups",
        { description: "Read groups and rename supported ordinary groups" },
        (command) =>
          command.add(renameCommand("group")).add(
            defineCommand(
              "list",
              { description: "List group IDs, names, and modification settings" },
              (leaf) =>
                leaf.flags(...readFlags).action(async ({ flags, stdout }) => {
                  const rows = await new StructureService(await clientFor(flags.budget)).groups();
                  print(
                    stdout,
                    flags.full === true
                      ? rows
                      : rows.map((row) =>
                          pick(row, ["id", "name", "type", "modifiable", "archived", "deleted"])
                        ),
                    flags.compact
                  );
                })
            )
          )
      )
    )
    .add(
      ...(["payees", "tags"] as const).map((name) =>
        defineCommand(name, { description: `Read ${name}` }, (command) =>
          command.add(
            defineCommand(
              "list",
              { description: `List IDs and usage counts for ${name}` },
              (leaf) =>
                leaf.flags(...readFlags).action(async ({ flags, stdout }) => {
                  const clientForResult1 = await clientFor(flags.budget);

                  const stashResult1 = await clientForResult1.stash(
                    name === "payees" ? "PAYEES" : "TAGS",
                    LabelsSchema
                  );

                  const rows = Object.values(stashResult1.data.data);
                  print(
                    stdout,
                    flags.full === true
                      ? rows
                      : rows.map((row) =>
                          pick(row, ["id", "name", "transactionCount", "archived"])
                        ),
                    flags.compact
                  );
                })
            )
          )
        )
      )
    )
    .add(
      defineCommand("schema", { description: "Show JSON schemas for write payloads" }, (command) =>
        command.flags(compactFlag).action(({ flags, stdout }) => {
          print(
            stdout,
            {
              accountUpdate: z.toJSONSchema(AccountPatchSchema),
              categoryCreate: z.toJSONSchema(CategoryCreationSchema),
              transactionCreate: z.toJSONSchema(TransactionCreateSchema),
              transactionDelete: z.toJSONSchema(TransactionDeleteSchema),
              transactionUpdate: z.toJSONSchema(TransactionPatchSchema),
            },
            flags.compact
          );
        })
      )
    )
    .add(createSkillsCommand(() => app));

  return app;
};
