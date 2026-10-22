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
import { LabelsSchema } from "../budget/labels.ts";
import { CategoriesSchema } from "../budget/model.ts";
import { TransactionCreateSchema, TransactionPatchSchema } from "../budget/transaction-model.ts";
import { TransactionService } from "../budget/transactions.ts";
import { BeyondClient } from "../firestore/client.ts";
import type { CommitOptions, CommitResult, Data } from "../firestore/encoding.ts";
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
  description: "Identify this commit with exactly 20 letters or digits",
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
        body: "Before a change:\n1. Use schema to find the accepted JSON fields.\n2. Use --dry-run --full to inspect all changes before the commit.\n\nAmounts use integer minor units (PHP centavos). bebu changes only one-off expenses and income without reconciliation. Transfers, allocations, splits, repeats, refunds, debts, files, and linked transactions require separate flows. A completed card expense requires a category with enough funds.\n\nTransaction metadata changes accept notes, color, and cleared. The --request-id flag identifies the atomic commit and its save marker.\n\nFor the same operation, reuse --request-id. For a different operation, use a new request ID.",
        title: "Write rules",
      },
    ],
    version: metadata.version,
  })
    .extend(help(), errorOutput)
    .add(authCommand, sessionCommand, accountsCommand, transactionsCommand)
    .add(
      defineCommand(
        "categories",
        { description: "Read expense and payment categories" },
        (command) =>
          command.add(
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
