import { z } from "zod";

import { savingsTargetDemand } from "./savings-target.ts";

const amountSchema = z.number().int();

const targetSchema = z.object({
  amount: amountSchema,
  carryOverStrategy: z.string(),
  createdAt: z.string().optional(),
  dayOfMonth: amountSchema.nullable(),
  dayOfWeekOrdinal: amountSchema.min(0).max(6).nullable(),
  dynamicSavingsTarget: z.boolean().optional(),
  endAt: z.string().nullable().optional(),
  period: z.string().nullable(),
  repeatIntervalMonths: amountSchema.nullable().optional(),
  snoozeSchedule: z.record(z.string(), z.boolean()),
  type: z.string(),
  useAllocatedAmountOnly: z.boolean().nullable(),
});

const inputSchema = z.object({
  balance: z.object({
    allocatedAmount: amountSchema,
    carriedOverAmount: amountSchema,
    otherAmount: amountSchema.optional(),
    spentAmount: amountSchema.optional(),
  }),
  calculationTimezone: z.string().optional(),
  category: z.object({
    accumulationStrategy: z.string(),
    aggregateAllocationForTarget: z.boolean(),
    amountComputationStrategy: z.string(),
    carryOverStrategy: z.string(),
    target: targetSchema.nullable(),
    type: z.string(),
  }),
  directChildren: z.array(z.object({ allocatedAmount: amountSchema })),
  yearMonth: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u),
});

// Callers resolve stored defaults, the selected-period balance, the complete direct-child list,
// and weekday enum ordinals. Null target represents a known absent/default target.
export type TargetDemandInput = z.infer<typeof inputSchema>;

interface TargetOrder {
  dayOfMonth: number | null;
  dayOfWeekOrdinal: number | null;
}

export type TargetDemandResult = TargetOrder &
  (
    | { eligible: true; reason: null; requestedAmount: number; status: "eligible" }
    | { eligible: false; reason: string; requestedAmount: 0; status: "ineligible" }
    | { eligible: false; reason: string; requestedAmount: null; status: "unsupported" }
  );

const supportedCarry = new Set(["ALL", "NONE"]);

const knownPeriods = new Set([
  "MONTHLY",
  "WEEKLY",
  "BI_MONTHLY",
  "EVERY_TWO_MONTHS",
  "ANNUALLY",
  "CUSTOM",
]);

const unsupportedCategoryReason = (category: TargetDemandInput["category"]) => {
  if (category.type !== "DEFAULT" && category.type !== "INCOME") {
    return "unsupported-category-type";
  }

  if (
    category.amountComputationStrategy !== "COMPUTE" &&
    category.amountComputationStrategy !== "SKIP"
  ) {
    return "unsupported-amount-computation-strategy";
  }

  if (
    category.accumulationStrategy !== "DEFAULT" &&
    category.accumulationStrategy !== "FUND_OVERRUNS"
  ) {
    return "unsupported-accumulation-strategy";
  }

  if (!supportedCarry.has(category.carryOverStrategy)) {
    return "unsupported-category-carryover";
  }

  return null;
};

const ineligibleReason = ({ category, yearMonth }: TargetDemandInput) => {
  if (category.amountComputationStrategy === "SKIP") {
    return "skip-computation";
  }

  if (category.type === "INCOME") {
    return "income-category";
  }

  if (category.accumulationStrategy === "FUND_OVERRUNS") {
    return "fund-overruns";
  }

  if (category.target === null) {
    return "no-target";
  }

  // Native 49250 uses PeriodDto.yearMonth, not the period document ID.
  if (
    Object.hasOwn(category.target.snoozeSchedule, yearMonth) &&
    category.target.snoozeSchedule[yearMonth] === true
  ) {
    return "snoozed";
  }

  if (category.target.amount <= 0) {
    return "nonpositive-target-amount";
  }

  return null;
};

const unsupportedTargetReason = (target: z.infer<typeof targetSchema>) => {
  if (target.type === "SAVINGS") {
    return target.createdAt === undefined ? "savings-creation-timestamp-required" : null;
  }

  if (target.type !== "ON_GOING_SAVINGS" && target.type !== "SPENDING") {
    return "unsupported-target-type";
  }

  if (!supportedCarry.has(target.carryOverStrategy)) {
    return "unsupported-target-carryover";
  }

  if (target.type === "SPENDING" && target.period !== "MONTHLY") {
    return "unsupported-target-period";
  }

  if (target.period !== null && !knownPeriods.has(target.period)) {
    return "unsupported-target-period";
  }

  return null;
};

const requestedAmount = (
  { category, balance, directChildren }: TargetDemandInput,
  target: z.infer<typeof targetSchema>
) => {
  let funded = BigInt(balance.allocatedAmount);

  if (category.aggregateAllocationForTarget) {
    for (const child of directChildren) {
      if (child.allocatedAmount > 0) {
        funded += BigInt(child.allocatedAmount);
      }
    }
  }

  const includeCarryover =
    target.type === "SPENDING" &&
    target.useAllocatedAmountOnly !== true &&
    target.carryOverStrategy === "ALL" &&
    category.carryOverStrategy === "ALL" &&
    balance.carriedOverAmount > 0;

  if (includeCarryover) {
    funded += BigInt(balance.carriedOverAmount);
  }

  const remaining = BigInt(target.amount) - funded;

  return amountSchema.parse(Number(remaining > 0n ? remaining : 0n));
};

// Eligibility is target-only (51912), not the smart workflow's broader filter.
// This implements the bounded static calculation contract, not native write parity.
export const calculateTargetDemand = (input: TargetDemandInput): TargetDemandResult => {
  const value = inputSchema.parse(input);
  const { category } = value;
  const { target } = category;

  const order = {
    dayOfMonth: target?.type === "SAVINGS" ? null : (target?.dayOfMonth ?? null),
    dayOfWeekOrdinal: target?.type === "SAVINGS" ? null : (target?.dayOfWeekOrdinal ?? null),
  };

  const categoryReason = unsupportedCategoryReason(category);

  if (categoryReason !== null) {
    return {
      ...order,
      eligible: false,
      reason: categoryReason,
      requestedAmount: null,
      status: "unsupported",
    };
  }

  const exclusion = ineligibleReason(value);

  if (exclusion !== null || target === null) {
    return {
      ...order,
      eligible: false,
      reason: exclusion ?? "no-target",
      requestedAmount: 0,
      status: "ineligible",
    };
  }

  const targetReason = unsupportedTargetReason(target);

  if (targetReason !== null) {
    return {
      ...order,
      eligible: false,
      reason: targetReason,
      requestedAmount: null,
      status: "unsupported",
    };
  }

  return {
    ...order,
    eligible: true,
    reason: null,
    requestedAmount:
      target.type === "SAVINGS" ? savingsTargetDemand(value) : requestedAmount(value, target),
    status: "eligible",
  };
};
