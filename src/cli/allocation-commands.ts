/* oxlint-disable func-style -- Named domain functions follow the repository TypeScript conventions. */
import { defineArg, defineCommand, defineFlag } from "@crustjs/core";
import { z } from "zod";

import { loadSession } from "../auth/session.ts";
import { saveAllocationFile } from "../budget/allocation-operations.ts";
import { AllocationPlanSchema } from "../budget/allocation-plan.ts";
import { AllocationService } from "../budget/allocation-service.ts";
import { BeyondClient } from "../firestore/client.ts";
import { compactFlag, payload, print } from "./io.ts";

export class AllocationExecutionError extends Error {
  readonly result: Awaited<ReturnType<AllocationService["apply"]>>;

  constructor(result: Awaited<ReturnType<AllocationService["apply"]>>) {
    super(result.reason ?? `Allocation outcome is ${result.status}`);
    this.result = result;
    this.name = "AllocationExecutionError";
  }
}

const budgetFlag = defineFlag("budget", { description: "Use this budget ID", type: "string" });

const fullFlag = defineFlag("full", {
  description: "Include the complete reviewed plan and writes",
  type: "boolean",
});

const monthFlag = defineFlag("month", {
  description: "Use the current existing YYYY-MM month",
  required: true,
  type: "string",
});

const requestArg = defineArg("request-id", {
  description: "Use the original 20-character request ID",
  required: true,
  type: "string",
});

async function service(budget?: string) {
  return new AllocationService(new BeyondClient(await loadSession(), { budget }));
}

export const manualAllocationCommands = [
  defineCommand(
    "set",
    {
      description: "Preview one absolute allocation or match its linked savings account",
      sections: [
        {
          body: "Requires --dry-run. Choose exactly one of --amount-minor or --match-linked. Negative amounts use --amount-minor=-2500. All amounts are signed integer minor units. Matching uses the cleared balance of exactly one active linked SAVINGS account. Uncleared money is reported separately. A zero-balance archived account with an empty reverse link is reported and preserved.\n\nThe planner uses one consistent snapshot and includes the complete budget pool. It supports DEFAULT leaf categories, one-level hierarchy elsewhere, payment-category presence, FUND_OVERRUNS, and ALL carryover on the selected category. It rejects historical months, period creation, archived categories, broken links, multiple future periods, and income, spending, or other funds in the next month. Positive deltas cannot overdraw the pool.\n\n--plan-file saves the private reviewed plan for allocations apply. --full includes the exact four-document write set. No financial write occurs during planning. The plan expires after 15 minutes and any changed dependency makes it stale. Target/smart preview commands remain read-only and cannot be applied through this command.",
          title: "Manual allocation",
        },
      ],
    },
    (leaf) =>
      leaf
        .args(defineArg("id", { description: "Category ID", required: true, type: "string" }))
        .flags(
          compactFlag,
          budgetFlag,
          fullFlag,
          monthFlag,
          {
            description: "Required: calculate without changing financial state",
            name: "dry-run",
            required: true,
            type: "boolean",
          },
          {
            description: "Set this signed safe-integer absolute allocation",
            name: "amount-minor",
            type: "string",
          },
          {
            description: "Match availability to one active savings account's cleared balance",
            name: "match-linked",
            type: "boolean",
          },
          {
            description: "Save the complete private plan to this file",
            name: "plan-file",
            type: "string",
          }
        )
        .action(async ({ args, flags, stdout }) => {
          if (!flags["dry-run"]) {
            throw new Error("allocations set requires --dry-run");
          }

          const amount = flags["amount-minor"];

          if ((amount !== undefined) === (flags["match-linked"] === true)) {
            throw new Error("Choose exactly one of --amount-minor or --match-linked");
          }

          const intent =
            amount === undefined
              ? { matchLinked: true as const }
              : {
                  amount: z
                    .number()
                    .int()
                    .parse(
                      Number(
                        z
                          .string()
                          .regex(/^-?\d+$/u)
                          .parse(amount)
                      )
                    ),
                };

          const allocations = await service(flags.budget);
          const plan = await allocations.preview(args.id, flags.month, intent);

          if (flags["plan-file"] !== undefined) {
            await saveAllocationFile(flags["plan-file"], plan);
          }

          print(
            stdout,
            flags.full === true
              ? { ...plan, dryRun: true, executionSupported: true }
              : {
                  dryRun: true,
                  executionSupported: true,
                  hash: plan.hash,
                  planFile: flags["plan-file"],
                  summary: plan.summary,
                },
            flags.compact
          );
        })
  ),
  defineCommand(
    "apply",
    {
      description: "Apply one reviewed manual allocation plan atomically",
      sections: [
        {
          body: "Requires a plan saved by allocations set and a new explicit request ID. The command rereads every dependency inside an optimistic transaction and rejects stale or edited plans. It writes the selected period, category history, budget MANUAL history, and native marker atomically. Account money and links are preserved.\n\nThe request is permanently claimed in BEBU_HOME before sending. Reuse the exact plan and request ID to inspect an identical operation; changed content is rejected. Unknown outcomes are never automatically resent. Use allocations recover with the original request ID and budget. Recovery depends on the trusted local record and native marker; cross-device or permanent remote payload binding is not provided.\n\nCommitted and synchronization-pending are separate results. Delayed carryover never causes another financial submission. Keep the local operation directory. This command does not implement undo, reallocation, automatic income allocation, or bulk overspending coverage.",
          title: "Execution and recovery",
        },
      ],
    },
    (leaf) =>
      leaf
        .flags(
          compactFlag,
          budgetFlag,
          {
            description: "Read the reviewed plan from this file",
            name: "plan",
            required: true,
            type: "string",
          },
          {
            description: "Permanently bind this new 20-character operation ID",
            name: "request-id",
            required: true,
            type: "string",
          }
        )
        .action(async ({ flags, stdout }) => {
          const plan = await payload(flags.plan, AllocationPlanSchema);

          const allocations = await service(flags.budget ?? plan.budgetId);
          const result = await allocations.apply(plan, flags["request-id"]);

          if (result.status === "rejected" || result.status === "unknown") {
            throw new AllocationExecutionError(result);
          }

          print(stdout, result, flags.compact);
        })
  ),
  defineCommand(
    "operation",
    { description: "Inspect the original local allocation operation without sending writes" },
    (leaf) =>
      leaf
        .args(requestArg)
        .flags(compactFlag, budgetFlag, fullFlag)
        .action(async ({ args, flags, stdout }) => {
          const allocations = await service(flags.budget);
          const result = await allocations.operation(args["request-id"]);
          print(
            stdout,
            flags.full === true
              ? result
              : {
                  requestId: result.requestId,
                  ...result.state,
                  hash: result.plan.hash,
                  summary: result.plan.summary,
                },
            flags.compact
          );
        })
  ),
  defineCommand(
    "recover",
    { description: "Observe the original allocation marker without resending uncertain work" },
    (leaf) =>
      leaf
        .args(requestArg)
        .flags(compactFlag, budgetFlag)
        .action(async ({ args, flags, stdout }) => {
          const allocations = await service(flags.budget);
          const result = await allocations.recover(args["request-id"]);
          print(stdout, result, flags.compact);
        })
  ),
];
