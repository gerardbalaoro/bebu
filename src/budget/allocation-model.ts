import { z } from "zod";

import { ObjectIdSchema } from "./transaction-model.ts";

export const allocationMoney = z.number().int().safe();

const weekday = z.enum([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

const carryover = z.enum(["ALL", "NONE"]);

// Omission defaults follow DTO decoders 48544, 48558, 48703, 48804, and 48812.
// Zod defaults apply only to undefined. Explicit null must retain its native validity rules.
const targetSchema = z.object({
  amount: allocationMoney.default(0),
  carryOverStrategy: carryover.default("ALL"),
  createdAt: z.string().optional(),
  dayOfMonth: allocationMoney.min(1).max(31).nullable().default(null),
  dayOfWeek: weekday.nullable().default(null),
  dynamicSavingsTarget: z.boolean().default(false),
  endAt: z.string().nullable().default(null),
  period: z.string().nullable().default(null),
  repeatIntervalMonths: allocationMoney.nullable().default(null),
  snoozeSchedule: z.record(z.string(), z.boolean()).default({}),
  type: z.string().default("SPENDING"),
  useAllocatedAmountOnly: z.boolean().nullable().default(null),
});

const categorySchema = z.object({
  accumulationStrategy: z.enum(["DEFAULT", "FUND_OVERRUNS"]).default("DEFAULT"),
  aggregateAllocationForTarget: z.boolean().default(false),
  amountComputationStrategy: z.enum(["COMPUTE", "SKIP"]).default("COMPUTE"),
  archived: z.boolean().default(false),
  carryOverStrategy: carryover.default("ALL"),
  deleted: z.boolean().default(false),
  groupId: ObjectIdSchema,
  id: ObjectIdSchema,
  linkedAccountIds: z.array(ObjectIdSchema).default([]),
  order: allocationMoney.default(0),
  parentCategoryId: z.string().default(""),
  systemGenerated: z.boolean().default(false),
  target: targetSchema.nullable().default(null),
  type: z.enum(["DEFAULT", "INCOME", "CREDIT_CARD_PAYMENT", "LOAN_PAYMENT"]).default("DEFAULT"),
});

const groupSchema = z.object({
  archived: z.boolean().default(false),
  id: ObjectIdSchema,
  order: allocationMoney.default(0),
  systemGenerated: z.boolean().default(false),
  type: z.enum(["DEFAULT", "INCOME", "DEBT_PAYMENT"]).default("DEFAULT"),
});

export const AllocationIndexSchema = z.object({
  data: z.object({
    categories: z.record(z.string(), categorySchema),
    groups: z.record(z.string(), groupSchema),
  }),
});

const balanceSchema = z.object({
  allocatedAmount: allocationMoney.default(0),
  carriedOverAmount: allocationMoney.default(0),
  otherAmount: allocationMoney.default(0),
  spentAmount: allocationMoney.default(0),
  upcomingAmount: allocationMoney.default(0),
});

export const AllocationPeriodSchema = z.object({
  allocationAmount: allocationMoney.default(0),
  allocationCarriedOverAmount: allocationMoney.default(0),
  balances: z.record(z.string(), balanceSchema).default({}),
  id: ObjectIdSchema,
  yearMonth: z.string(),
});

export const targetInputCategory = (category: z.infer<typeof categorySchema>) => ({
  ...category,
  target:
    category.target === null
      ? null
      : {
          ...category.target,
          dayOfWeekOrdinal:
            category.target.dayOfWeek === null
              ? null
              : weekday.options.indexOf(category.target.dayOfWeek),
        },
});

const orderedAllocationGroups = (groups: Record<string, z.infer<typeof groupSchema>>) => {
  const groupOrders = new Set<number>();
  const orderedGroups = Object.entries(groups).toSorted((a, b) => a[1].order - b[1].order);

  for (const [key, group] of orderedGroups) {
    if (
      key !== group.id ||
      group.archived ||
      group.systemGenerated ||
      group.type === "DEBT_PAYMENT"
    ) {
      throw new Error(`Unsupported allocation group ${key}: identity, archive, or special group`);
    }

    if (groupOrders.has(group.order)) {
      throw new Error("Allocation group order is ambiguous");
    }

    groupOrders.add(group.order);
  }

  return orderedGroups;
};

// This is a bounded flat model. Reject unresolved hierarchy/visibility rules before computing a pool.
export const allocationModel = (
  index: z.infer<typeof AllocationIndexSchema>,
  period: z.infer<typeof AllocationPeriodSchema>
) => {
  const { categories, groups } = index.data;
  const categoryOrders = new Set<string>();
  const orderedGroups = orderedAllocationGroups(groups);

  for (const [key, category] of Object.entries(categories)) {
    if (
      key !== category.id ||
      !Object.hasOwn(groups, category.groupId) ||
      category.parentCategoryId !== ""
    ) {
      throw new Error(`Unsupported allocation category ${key}: identity, group, or hierarchy`);
    }

    if (category.deleted) {
      continue;
    }

    const ordinary = category.type === "DEFAULT" || category.type === "INCOME";

    if (
      category.archived ||
      category.systemGenerated ||
      category.linkedAccountIds.length > 0 ||
      !ordinary
    ) {
      throw new Error(
        `Unsupported allocation category ${key}: archive, linked account, or special category`
      );
    }

    const keyOrder = `${category.groupId}:${category.order}`;

    if (categoryOrders.has(keyOrder)) {
      throw new Error(`Allocation category order is ambiguous in ${category.groupId}`);
    }

    categoryOrders.add(keyOrder);
  }

  const ordered = orderedGroups.flatMap(([, group]) =>
    Object.values(categories)
      .filter((category) => !category.deleted && category.groupId === group.id)
      .toSorted((a, b) => a.order - b.order)
      .map((category) => ({
        balance: period.balances[category.id] ?? balanceSchema.parse({}),
        category,
        group,
      }))
  );

  let allocated = 0n;

  for (const row of ordered) {
    if (row.group.type !== "INCOME" && row.category.amountComputationStrategy === "COMPUTE") {
      allocated += BigInt(row.balance.allocatedAmount);
    }
  }

  const allocatedAmount = allocationMoney.parse(Number(allocated));

  const availableAmount = allocationMoney.parse(
    Number(BigInt(period.allocationAmount) + BigInt(period.allocationCarriedOverAmount) - allocated)
  );

  return {
    categories: ordered,
    pool: {
      allocatedAmount,
      allocationAmount: period.allocationAmount,
      allocationCarriedOverAmount: period.allocationCarriedOverAmount,
      availableAmount,
    },
  };
};
