import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { positiveHistoryAverage } from "./allocation-history-average.ts";
import { AllocationPeriodSchema } from "./allocation-model.ts";
import { ObjectIdSchema } from "./transaction-model.ts";

// This exposes the recovered positive-month arithmetic as a read query. It does not reproduce
// historical auto-allocation ordering, replacement behavior, or transaction projections.
export const allocationAverages = async (client: BeyondClient, before: string, count: number) => {
  const monthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u);
  monthSchema.parse(before);
  z.union([z.literal(1), z.literal(3)]).parse(count);
  const budget = await client.discover();

  const periods = Object.entries(budget.data.availablePeriods)
    .map(([yearMonth, period]) => ({
      periodId: ObjectIdSchema.parse(period.id),
      yearMonth: monthSchema.parse(yearMonth),
    }))
    .filter((period) => period.yearMonth < before)
    .toSorted((a, b) => b.yearMonth.localeCompare(a.yearMonth))
    .slice(0, count);

  const documents = await Promise.all(
    periods.map(async ({ periodId, yearMonth }) => {
      const document = await client.document(
        `${client.budgetPath}/periods/${periodId}`,
        AllocationPeriodSchema
      );

      if (document.data.id !== periodId || document.data.yearMonth !== yearMonth) {
        throw new Error("Historical allocation period identity does not match its saved month");
      }

      return document;
    })
  );

  const categoryIds = new Set(documents.flatMap((document) => Object.keys(document.data.balances)));

  return {
    before,
    budgetId: client.budgetId,
    categories: [...categoryIds].toSorted().map((categoryId) => ({
      allocated: positiveHistoryAverage(
        documents.map((document) => document.data.balances[categoryId]?.allocatedAmount ?? 0)
      ),
      categoryId,
      spent: positiveHistoryAverage(
        documents.map((document) => document.data.balances[categoryId]?.spentAmount ?? 0)
      ),
    })),
    periods,
    requestedPeriods: count,
    sources: [budget, ...documents].map((document) => ({
      document: document.name,
      updateTime: document.updateTime,
    })),
  };
};
