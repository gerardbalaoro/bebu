/* oxlint-disable func-style, no-await-in-loop -- Historical previews read ordered dependencies without issuing financial writes. */
import { z } from "zod";

import { DataSchema } from "../firestore/encoding.ts";
import { auditCarryover, CarryoverMonthSchema } from "./carryover.ts";
import type { CarryoverPeriod } from "./carryover.ts";
import { ObjectIdSchema } from "./transaction-model.ts";
import type { transactionSummary } from "./transaction-summary.ts";
import type { MutationPlan, TransactionContext } from "./transactions.ts";

export async function previewTransactionCarryover(
  plan: MutationPlan,
  summary: ReturnType<typeof transactionSummary>,
  context: TransactionContext
) {
  const categories = summary.categories.filter(
    (row) => row.after.availableAmount !== row.before.availableAmount
  );

  for (const row of [...categories, ...summary.allocationPeriods]) {
    if (context.budget.data.availablePeriods[row.yearMonth]?.id !== row.periodId) {
      throw new Error("Historical carryover preview found a transaction month/period mismatch");
    }
  }

  const changedMonths = [
    ...new Set([
      ...categories.map((row) => CarryoverMonthSchema.parse(row.yearMonth)),
      ...summary.allocationPeriods.map((row) => CarryoverMonthSchema.parse(row.yearMonth)),
    ]),
  ].toSorted();

  const [firstMonth] = changedMonths;

  if (firstMonth === undefined) {
    return null;
  }

  const savedMonths = Object.keys(context.budget.data.availablePeriods)
    .map((month) => CarryoverMonthSchema.parse(month))
    .toSorted();

  const laterMonths = savedMonths.filter((month) => month > firstMonth);

  if (laterMonths.length === 0) {
    return null;
  }

  const categoryIds = [...new Set(categories.map((row) => row.id))].toSorted();
  const start = Math.max(0, savedMonths.indexOf(firstMonth) - 1);
  const selected = savedMonths.slice(start);
  const periods: CarryoverPeriod[] = [];

  const sources = [context.budget, context.categories].map((doc) => ({
    document: doc.name,
    updateTime: doc.updateTime,
  }));

  for (const yearMonth of selected) {
    const periodId = ObjectIdSchema.parse(context.budget.data.availablePeriods[yearMonth]?.id);

    const { doc } = await plan.entry(`${plan.client.budgetPath}/periods/${periodId}`);

    if (
      (doc.data.id !== undefined && doc.data.id !== periodId) ||
      (doc.data.yearMonth !== undefined && doc.data.yearMonth !== yearMonth)
    ) {
      throw new Error("Historical carryover preview found a period identity mismatch");
    }

    sources.push({ document: doc.name, updateTime: doc.updateTime });
    periods.push({
      balances: z.record(z.string(), DataSchema).parse(doc.data.balances ?? {}),
      periodId,
      yearMonth,
    });
  }

  return {
    audit: {
      ...auditCarryover(context.categoryMap, periods, categoryIds),
      snapshotConsistent: plan.snapshot !== undefined,
      sources,
    },
    categoryIds,
    changedMonths,
    executionSupported: false,
    laterMonths,
    reason:
      "Historical funding changes require verified downstream carryover. Existing discontinuities and later-period propagation remain unverified; no repair or future-period write is authorized",
    resourcePoolAffected: summary.allocationPeriods.length > 0,
    scope: "existing-saved-downstream-periods",
    status: "unverified" as const,
  };
}

export class HistoricalTransactionError extends Error {
  readonly result;

  constructor(
    preview: NonNullable<Awaited<ReturnType<typeof previewTransactionCarryover>>>,
    requestId?: string
  ) {
    super(preview.reason);
    this.name = "HistoricalTransactionError";
    this.result = { downstreamCarryover: preview, executionSupported: false, requestId };
  }
}
