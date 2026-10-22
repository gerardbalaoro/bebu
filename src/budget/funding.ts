import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { CategoriesSchema, PeriodSchema } from "./model.ts";
import type { Balance, Category } from "./model.ts";
import { ObjectIdSchema } from "./transaction-model.ts";

export const fundingAmounts = (balance: Balance = {}) => {
  const money = z.number().int().safe();

  const amounts = {
    allocatedAmount: money.parse(balance.allocatedAmount ?? 0),
    carriedOverAmount: money.parse(balance.carriedOverAmount ?? 0),
    otherAmount: money.parse(balance.otherAmount ?? 0),
    spentAmount: money.parse(balance.spentAmount ?? 0),
    upcomingAmount: money.parse(balance.upcomingAmount ?? 0),
  };

  const availableAmount = Number(
    BigInt(amounts.allocatedAmount) +
      BigInt(amounts.carriedOverAmount) +
      BigInt(amounts.otherAmount) -
      BigInt(amounts.spentAmount)
  );

  if (!Number.isSafeInteger(availableAmount)) {
    throw new TypeError("Category available funds must be a safe integer");
  }

  return { ...amounts, availableAmount };
};

type CategoryFunding = Partial<
  Pick<Category, "archived" | "deleted" | "groupId" | "name" | "nature" | "type">
> & { id: string } & ReturnType<typeof fundingAmounts>;

export const categoryFunding = async (
  client: BeyondClient,
  yearMonth: string,
  categoryId?: string
) => {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(yearMonth)) {
    throw new Error("Use a month in YYYY-MM format");
  }

  if (categoryId !== undefined) {
    ObjectIdSchema.parse(categoryId);
  }

  const budget = await client.discover();
  const periodId = budget.data.availablePeriods[yearMonth]?.id;

  if (!periodId) {
    throw new Error(`Budget period ${yearMonth} does not exist. Select an existing month`);
  }

  ObjectIdSchema.parse(periodId);

  const [categories, period] = await Promise.all([
    client.stash("GROUPS_AND_CATEGORIES", CategoriesSchema),
    client.document(`${client.budgetPath}/periods/${periodId}`, PeriodSchema),
  ]);

  const categoryMap = categories.data.data.categories;
  const ids = new Set([...Object.keys(categoryMap), ...Object.keys(period.data.balances)]);

  if (categoryId !== undefined && !ids.has(categoryId)) {
    throw new Error("Category not found in the category index or selected period");
  }

  return {
    categories: (categoryId === undefined ? [...ids] : [categoryId]).map((id): CategoryFunding => {
      const category = categoryMap[id];

      return {
        archived: category?.archived,
        deleted: category?.deleted,
        groupId: category?.groupId,
        id,
        name: category?.name,
        nature: category?.nature,
        type: category?.type,
        ...fundingAmounts(period.data.balances[id]),
      };
    }),
    periodId,
    yearMonth,
  };
};
