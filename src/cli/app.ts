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
import { budgetDiagnostics } from "../budget/diagnostics.ts";
import { categoryFunding } from "../budget/funding.ts";
import { LabelsSchema } from "../budget/labels.ts";
import { CategoriesSchema } from "../budget/model.ts";
import { categoryTargets } from "../budget/targets.ts";
import { TransactionCreateSchema, TransactionPatchSchema } from "../budget/transaction-model.ts";
import { TransactionService } from "../budget/transactions.ts";
import { BeyondClient } from "../firestore/client.ts";
import type { CommitOptions, CommitResult, Data } from "../firestore/encoding.ts";
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

const requestFlag = defineFlag("request-id", {
  description:
    "Identify one operation with 20 letters or digits. Reuse only for an identical retry",
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

const writeResult = (result: CommitResult, full?: boolean) => {
  if (!("dryRun" in result) || full) {
    return result;
  }

  return {
    ...result,
    affected: result.body.writes.map((write) => ({
      document: (write.update?.name ?? write.delete)?.split("/documents/")[1],
      fields: write.updateMask?.fieldPaths,
      operation: write.delete ? "delete" : "update",
      transforms: write.updateTransforms?.map((transform) => transform.fieldPath),
    })),
    body: undefined,
  };
};

const errorOutput = defineExtension(defineExtensionId("bebu.error-output")).onError(
  (error, { stderr, argv, commandPath }) => {
    if (error instanceof AllocationExecutionError) {
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
                flags.full
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

const transactionsCommand = defineCommand(
  "transactions",
  { description: "Read history and write one-off expenses or income" },
  (command) =>
    command
      .add(
        defineCommand(
          "list",
          {
            description:
              "Read the complete history, including older records absent from the app cache",
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

                const rows = flags.full
                  ? result.transactions
                  : result.transactions.map((transaction) => ({
                      ...pick(transaction, [
                        "id",
                        "type",
                        "amount",
                        "completed",
                        "cleared",
                        "dueAt",
                        "notes",
                      ]),
                      fromId: transaction.targetFrom?.id,
                      toId: transaction.targetTo?.id,
                    }));

                print(stdout, { ...result, transactions: rows }, flags.compact);
              })
        )
      )
      .add(
        defineCommand("show", { description: "Read a complete transaction record" }, (leaf) =>
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
              "Create an expense or income with all ledger changes. The command does not allocate funds automatically",
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
            description: "Change notes, color, or cleared status in the record and its indexes",
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
            description: "Delete a supported transaction and reverse its ledger effects atomically",
          },
          (leaf) =>
            leaf
              .flags(...writeFlags)
              .args(idArg)
              .action(async ({ args, flags, stdout }) => {
                const result = await new TransactionService(await clientFor(flags.budget)).delete(
                  args.id,
                  writeOptions(flags)
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
              .action(async ({ flags, stdout }) =>
                print(
                  stdout,
                  await allocationAverages(
                    await clientFor(flags.budget),
                    flags.before,
                    flags.periods
                  ),
                  flags.compact
                )
              )
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
              .action(async ({ flags, stdout }) =>
                print(
                  stdout,
                  await allocationHistory(await clientFor(flags.budget), {
                    categoryId: flags.category,
                    includeTransactions: flags.transactions,
                    yearMonth: flags.month,
                  }),
                  flags.compact
                )
              )
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
              .action(async ({ flags, stdout }) =>
                print(
                  stdout,
                  await allocationReport(await clientFor(flags.budget), flags.month),
                  flags.compact
                )
              )
        )
      )
);

const targetsCommand = defineCommand(
  "targets",
  { description: "Inspect stored category targets" },
  (command) =>
    command.add(
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
            .action(async ({ flags, stdout }) =>
              print(
                stdout,
                await categoryTargets(await clientFor(flags.budget), {
                  categoryId: flags.category,
                  yearMonth: flags.month,
                }),
                flags.compact
              )
            )
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
        body: "Before a change:\n1. Use schema to find the accepted JSON fields.\n2. Use --dry-run to inspect transaction amounts before and after the change. Add --full to inspect all writes.\n\nAmounts use integer minor units (PHP centavos). bebu changes only one-off expenses and income without reconciliation. Transfers, splits, repeats, refunds, debts, files, and linked transactions require separate flows. For manual allocations, use allocations set --dry-run followed by allocations apply with the saved plan and an explicit request ID. A completed card expense requires a category with enough funds.\n\nTransaction metadata changes accept notes, color, and cleared. The --request-id flag identifies the atomic commit and its save marker.\n\nFor an identical retry, reuse --request-id and the original payload. For a different operation, use a new request ID. Save markers do not bind the ID to a payload. An alreadyCommitted result proves marker existence only. Marker expiry and validation before the commit also limit retries.",
        title: "Write rules",
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
        { description: "Read expense and payment categories" },
        (command) =>
          command.add(fundingCommand).add(
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
                  flags.full
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
                    flags.full
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
              transactionCreate: z.toJSONSchema(TransactionCreateSchema),
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
