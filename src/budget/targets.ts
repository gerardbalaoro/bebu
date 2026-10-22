import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema } from "../firestore/encoding.ts";
import type { Data } from "../firestore/encoding.ts";
import { ObjectIdSchema } from "./transaction-model.ts";

export interface CategoryTargetsOptions {
  yearMonth?: string;
  categoryId?: string;
}

const money = z.number().int().safe();

const balanceSchema = z.looseObject({
  allocatedAmount: money.optional(),
  carriedOverAmount: money.optional(),
  otherAmount: money.optional(),
  spentAmount: money.optional(),
  upcomingAmount: money.optional(),
});

const availabilityFields = [
  "allocatedAmount",
  "carriedOverAmount",
  "otherAmount",
  "spentAmount",
] as const;

const monthAvailability = (rawBalance: Data | undefined) => {
  const balance = balanceSchema.parse(rawBalance ?? {});
  const { allocatedAmount, carriedOverAmount, otherAmount, spentAmount } = balance;
  const missingFields = availabilityFields.filter((field) => balance[field] === undefined);
  let availableAmount: number | null = null;

  if (
    allocatedAmount !== undefined &&
    carriedOverAmount !== undefined &&
    otherAmount !== undefined &&
    spentAmount !== undefined
  ) {
    availableAmount = Number(
      BigInt(allocatedAmount) +
        BigInt(carriedOverAmount) +
        BigInt(otherAmount) -
        BigInt(spentAmount)
    );

    if (!Number.isSafeInteger(availableAmount)) {
      throw new TypeError("Category available funds must be a safe integer");
    }
  }

  let status = "available";

  if (rawBalance === undefined) {
    status = "missing-balance";
  } else if (missingFields.length > 0) {
    status = "incomplete-balance";
  }

  return {
    allocatedAmount: allocatedAmount ?? null,
    availableAmount,
    balance: rawBalance ?? null,
    missingFields,
    status,
  };
};

interface CategoryTarget {
  categoryId: string;
  category: Data;
  target: Data;
  progress: { status: "not-calculated" };
  month?: ReturnType<typeof monthAvailability>;
}

// Targets use ascending UTF-16 category-map-key order. Raw settings do not imply a progress formula.
// Availability is reported only when all four operands are present; sparse balances remain explicit.
export const categoryTargets = async (
  client: BeyondClient,
  options: CategoryTargetsOptions = {}
) => {
  const { yearMonth, categoryId } = options;

  if (yearMonth !== undefined && !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(yearMonth)) {
    throw new Error("Use a month in YYYY-MM format");
  }

  if (categoryId !== undefined) {
    ObjectIdSchema.parse(categoryId);
  }

  const budget = await client.discover();

  const periodId =
    yearMonth === undefined ? undefined : budget.data.availablePeriods[yearMonth]?.id;

  if (yearMonth !== undefined && !periodId) {
    throw new Error(`Budget period ${yearMonth} does not exist. Select an existing month`);
  }

  if (periodId !== undefined) {
    ObjectIdSchema.parse(periodId);
  }

  const [categories, period] = await Promise.all([
    client.stash(
      "GROUPS_AND_CATEGORIES",
      z.object({ data: z.object({ categories: z.record(z.string(), DataSchema) }) })
    ),
    periodId === undefined
      ? undefined
      : client.document(
          `${client.budgetPath}/periods/${periodId}`,
          z.object({ balances: z.record(z.string(), DataSchema) })
        ),
  ]);

  const categoryMap = categories.data.data.categories;

  if (categoryId !== undefined && !Object.hasOwn(categoryMap, categoryId)) {
    throw new Error("Category not found in the category index");
  }

  const targets: CategoryTarget[] = [];

  for (const id of categoryId === undefined ? Object.keys(categoryMap).toSorted() : [categoryId]) {
    const category = categoryMap[id];

    if (!category || category.target === undefined || category.target === null) {
      continue;
    }

    targets.push({
      category,
      categoryId: id,
      month: period === undefined ? undefined : monthAvailability(period.data.balances[id]),
      progress: { status: "not-calculated" },
      target: DataSchema.parse(category.target),
    });
  }

  const documents = period === undefined ? [budget, categories] : [budget, categories, period];

  return {
    budgetId: client.budgetId,
    periodId,
    sources: documents.map((document) => ({
      document: document.name,
      updateTime: document.updateTime,
    })),
    targets,
    yearMonth,
  };
};
