import { expect, test } from "bun:test";

import { calculateTargetDemand } from "./target-demand.ts";
import type { TargetDemandInput } from "./target-demand.ts";

type SavingsInput = TargetDemandInput & {
  balance: { otherAmount: number; spentAmount: number };
  calculationTimezone: string;
  category: { target: NonNullable<TargetDemandInput["category"]["target"]> };
};

const input = (): SavingsInput => ({
  balance: { allocatedAmount: 0, carriedOverAmount: 0, otherAmount: 0, spentAmount: 0 },
  calculationTimezone: "UTC",
  category: {
    accumulationStrategy: "DEFAULT",
    aggregateAllocationForTarget: false,
    amountComputationStrategy: "COMPUTE",
    carryOverStrategy: "ALL",
    target: {
      amount: 100,
      carryOverStrategy: "ALL",
      createdAt: "2026-01-15T12:00:00Z",
      dayOfMonth: 1,
      dayOfWeekOrdinal: 0,
      dynamicSavingsTarget: false,
      endAt: "2026-04-14T12:00:00Z",
      period: null,
      repeatIntervalMonths: null,
      snoozeSchedule: {},
      type: "SAVINGS",
      useAllocatedAmountOnly: false,
    },
    type: "DEFAULT",
  },
  directChildren: [],
  yearMonth: "2026-01",
});

test.each([
  ["2025-12", 0, 0],
  ["2026-01", 0, 33],
  ["2026-02", 25, 41],
  ["2026-03", 0, 100],
  ["2026-04", 0, 99],
  ["2025-12", -20, 20],
] as const)(
  "fixed savings preserves catch-up and final-count rounding for %s",
  (month, allocated, want) => {
    const value = input();
    value.yearMonth = month;
    value.balance.allocatedAmount = allocated;
    expect(calculateTargetDemand(value)).toEqual({
      dayOfMonth: null,
      dayOfWeekOrdinal: null,
      eligible: true,
      reason: null,
      requestedAmount: want,
      status: "eligible",
    });
  }
);

test.each([
  ["2026-02", 20, 0, 20],
  ["2026-04", 20, 0, 60],
  ["2026-05", 20, 0, 60],
  ["2026-02", -20, 140, 20],
] as const)(
  "dynamic savings retains both allocation deductions for %s",
  (month, allocated, other, want) => {
    const value = input();
    value.category.target.dynamicSavingsTarget = true;
    value.yearMonth = month;
    value.balance.allocatedAmount = allocated;
    value.balance.otherAmount = other;
    expect(calculateTargetDemand(value).requestedAmount).toBe(want);
  }
);

test("savings funds include spending, other funds, signed category carryover, and positive children", () => {
  const value = input();
  value.category.target.endAt = null;
  value.category.target.useAllocatedAmountOnly = true;
  value.category.target.carryOverStrategy = "NONE";
  value.balance = { allocatedAmount: 10, carriedOverAmount: -30, otherAmount: 5, spentAmount: 25 };
  value.category.aggregateAllocationForTarget = true;
  value.directChildren = [{ allocatedAmount: 15 }, { allocatedAmount: -500 }];
  expect(calculateTargetDemand(value).requestedAmount).toBe(125);
  value.category.carryOverStrategy = "NONE";
  expect(calculateTargetDemand(value).requestedAmount).toBe(95);
  value.category.target.dynamicSavingsTarget = true;
  expect(calculateTargetDemand(value).requestedAmount).toBe(95);
});

test("fixed savings uses whole calendar months with creation-day and leap-year adjustments", () => {
  const value = input();
  value.yearMonth = "2026-03";
  value.category.target.endAt = "2026-04-15T12:00:00Z";
  expect(calculateTargetDemand(value).requestedAmount).toBe(75);
  value.category.target.createdAt = "2024-01-31T12:00:00Z";
  value.category.target.endAt = "2024-02-29T12:00:00Z";
  value.yearMonth = "2024-01";
  expect(calculateTargetDemand(value).requestedAmount).toBe(100);
});

test("explicit timezone controls dates across month boundaries and DST transitions", () => {
  const value = input();
  value.yearMonth = "2026-02";
  value.category.target.createdAt = "2026-02-01T00:30:00Z";
  value.category.target.endAt = "2026-04-01T00:30:00Z";
  expect(calculateTargetDemand(value).requestedAmount).toBe(33);
  value.calculationTimezone = "America/Los_Angeles";
  expect(calculateTargetDemand(value).requestedAmount).toBe(66);
  value.calculationTimezone = "Asia/Manila";
  expect(calculateTargetDemand(value).requestedAmount).toBe(33);
});

test("savings rejects missing calculation context, repeats, invalid dates, and overflow", () => {
  const value = input();

  for (const changed of [
    { ...value, calculationTimezone: undefined },
    { ...value, calculationTimezone: "Invalid/Zone" },
    {
      ...value,
      category: {
        ...value.category,
        target: { ...value.category.target, repeatIntervalMonths: 1 },
      },
    },
    {
      ...value,
      category: {
        ...value.category,
        target: { ...value.category.target, endAt: "2025-01-01T00:00:00Z" },
      },
    },
  ]) {
    expect(() => calculateTargetDemand(changed)).toThrow();
  }

  expect(
    calculateTargetDemand({
      ...value,
      category: { ...value.category, target: { ...value.category.target, createdAt: undefined } },
    })
  ).toMatchObject({ eligible: false, requestedAmount: null, status: "unsupported" });

  value.category.target.createdAt = "not-a-date";
  expect(() => calculateTargetDemand(value)).toThrow();
  value.category.target.createdAt = "2026-01-01T00:00:00Z";
  value.category.target.endAt = null;
  value.category.target.amount = Number.MAX_SAFE_INTEGER;
  value.balance.allocatedAmount = -1;
  expect(() => calculateTargetDemand(value)).toThrow();
});

test("dynamic savings includes positive child allocations in both native deductions", () => {
  const value = input();
  value.yearMonth = "2026-02";
  value.category.target.dynamicSavingsTarget = true;
  value.category.aggregateAllocationForTarget = true;
  value.balance.allocatedAmount = 5;
  value.directChildren = [{ allocatedAmount: 15 }, { allocatedAmount: -500 }];
  expect(calculateTargetDemand(value).requestedAmount).toBe(20);
});
