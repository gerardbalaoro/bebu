/* oxlint-disable func-style -- Named domain functions follow the repository TypeScript conventions. */
import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema } from "../firestore/encoding.ts";
import type { AllocationPlan } from "./allocation-plan.ts";

const SummarySchema = z.object({
  after: z.object({
    allocation: z.number().int(),
    available: z.number().int(),
    pool: z.number().int(),
  }),
  before: z.object({ allocation: z.number().int() }),
});

function historyMatches(
  history: z.infer<typeof DataSchema> | undefined,
  plan: AllocationPlan,
  summary: z.infer<typeof SummarySchema>
) {
  return (
    history !== undefined &&
    history.source === "MANUAL" &&
    history.beforeAmount === summary.before.allocation &&
    history.afterAmount === summary.after.allocation &&
    history.categoryId === plan.categoryId
  );
}

export async function observeAllocation(client: BeyondClient, plan: AllocationPlan) {
  try {
    const summary = SummarySchema.parse(plan.summary);
    const root = await client.document(client.budgetPath);

    const budget = z
      .object({
        allocationHistory: z.record(z.string(), DataSchema),
        availablePeriods: z.record(z.string(), z.object({ id: z.string() })),
        stashIdentifiers: z.object({ ACCOUNTS: z.string(), GROUPS_AND_CATEGORIES: z.string() }),
      })
      .parse(root.data);

    const history = budget.allocationHistory[plan.historyId];

    if (!historyMatches(history, plan, summary)) {
      return { reason: "The original manual history is absent or has changed", status: "changed" };
    }

    const periodPath = `${client.budgetPath}/periods/${budget.availablePeriods[plan.month]?.id}`;

    const laterPaths = Object.entries(budget.availablePeriods)
      .filter(([month]) => month > plan.month)
      .map(([, period]) => `${client.budgetPath}/periods/${period.id}`);

    const accountsPath = `${client.budgetPath}/stashes/${budget.stashIdentifiers.ACCOUNTS}`;
    const indexPath = `${client.budgetPath}/stashes/${budget.stashIdentifiers.GROUPS_AND_CATEGORIES}`;

    if (
      [periodPath, accountsPath, indexPath, ...laterPaths].some(
        (path) => !plan.sources.some((source) => source.document === path)
      )
    ) {
      return {
        reason: "Budget period or index membership changed after planning",
        status: "changed",
      };
    }

    const [period, metadata, accounts, index, ...later] = await Promise.all([
      client.document(periodPath),
      client.document(`${client.budgetPath}/stashes/${plan.categoryId}`),
      client.document(accountsPath),
      client.document(indexPath),
      ...laterPaths.map(async (path) => await client.document(path)),
    ]);

    if (
      [accounts, index].some(
        (document) =>
          document.updateTime !==
          plan.sources.find((source) => source.document === document.name)?.updateTime
      )
    ) {
      return {
        reason: "Accounts or category configuration changed after the reviewed snapshot",
        status: "changed",
      };
    }

    const balance = z.object({ balances: z.record(z.string(), DataSchema) }).parse(period.data)
      .balances[plan.categoryId];

    const historical = z
      .object({ data: z.object({ historicalAllocations: DataSchema }) })
      .parse(metadata.data).data.historicalAllocations;

    if (
      balance?.allocatedAmount !== summary.after.allocation ||
      balance.updatedAt !== plan.createdAt ||
      historical[plan.month] !== summary.after.allocation
    ) {
      return {
        reason: "The category has changed since the original allocation",
        status: "changed",
      };
    }

    for (const document of later) {
      const future = z
        .object({
          allocationCarriedOverAmount: z.number().int().default(0),
          balances: z.record(z.string(), DataSchema).default({}),
        })
        .parse(document.data);

      if (
        (future.balances[plan.categoryId]?.carriedOverAmount ?? 0) !== summary.after.available ||
        future.allocationCarriedOverAmount !== summary.after.pool
      ) {
        return {
          reason:
            "Later-period carryover has not reached the expected values; no financial retry was made",
          status: "pending",
        };
      }
    }

    return { status: "verified" };
  } catch (error) {
    return {
      reason: error instanceof Error ? error.message : "Synchronization could not be read",
      status: "pending",
    };
  }
}
