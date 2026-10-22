import { expect, test } from "bun:test";

import { calculateTargetDemand } from "./target-demand.ts";
import type { TargetDemandInput } from "./target-demand.ts";

// Hand-derived expectations from WASM 49209/49244; these are not native execution fixtures.
type InputWithTarget = TargetDemandInput & {
  category: { target: NonNullable<TargetDemandInput["category"]["target"]> };
};

const input = (): InputWithTarget => ({
  balance: { allocatedAmount: 200, carriedOverAmount: 300 },
  category: {
    accumulationStrategy: "DEFAULT",
    aggregateAllocationForTarget: false,
    amountComputationStrategy: "COMPUTE",
    carryOverStrategy: "ALL",
    target: {
      amount: 1000,
      carryOverStrategy: "ALL",
      dayOfMonth: null,
      dayOfWeekOrdinal: null,
      period: null,
      snoozeSchedule: {},
      type: "ON_GOING_SAVINGS",
      useAllocatedAmountOnly: false,
    },
    type: "DEFAULT",
  },
  directChildren: [{ allocatedAmount: 150 }, { allocatedAmount: -500 }],
  yearMonth: "2026-10",
});

test("ongoing savings ignores carryover and disabled child aggregation", () => {
  expect(calculateTargetDemand(input())).toEqual({
    dayOfMonth: null,
    dayOfWeekOrdinal: null,
    eligible: true,
    reason: null,
    requestedAmount: 800,
    status: "eligible",
  });
});

test("aggregation counts only positive direct allocations and preserves signed parent allocation", () => {
  const value = input();
  value.category.aggregateAllocationForTarget = true;
  value.balance.allocatedAmount = -100;
  expect(calculateTargetDemand(value).requestedAmount).toBe(950);
});

test.each([
  ["ALL", "ALL", false, 300, 500],
  ["ALL", "ALL", null, 300, 500],
  ["ALL", "ALL", true, 300, 800],
  ["NONE", "ALL", false, 300, 800],
  ["ALL", "NONE", false, 300, 800],
  ["ALL", "ALL", false, -300, 800],
  ["ALL", "ALL", false, 0, 800],
] as const)(
  "monthly spending uses carryover only for both ALL and not allocated-only: %s/%s/%s/%s",
  (categoryCarry, targetCarry, allocatedOnly, carriedOver, want) => {
    const value = input();
    value.category.carryOverStrategy = categoryCarry;
    value.balance.carriedOverAmount = carriedOver;
    value.category.target = {
      ...value.category.target,
      carryOverStrategy: targetCarry,
      period: "MONTHLY",
      type: "SPENDING",
      useAllocatedAmountOnly: allocatedOnly,
    };
    expect(calculateTargetDemand(value).requestedAmount).toBe(want);
  }
);

test("monthly spending combines positive children and carryover before clamping demand", () => {
  const value = input();
  value.category.aggregateAllocationForTarget = true;
  value.category.target = { ...value.category.target, period: "MONTHLY", type: "SPENDING" };
  expect(calculateTargetDemand(value).requestedAmount).toBe(350);
  value.balance.allocatedAmount = 2000;
  expect(calculateTargetDemand(value)).toMatchObject({ eligible: true, requestedAmount: 0 });
});

test.each([
  ["type", "INCOME", "income-category"],
  ["amountComputationStrategy", "SKIP", "skip-computation"],
  ["accumulationStrategy", "FUND_OVERRUNS", "fund-overruns"],
] as const)("target-only eligibility excludes %s=%s", (field, setting, reason) => {
  const value = input();
  value.category[field] = setting;
  expect(calculateTargetDemand(value)).toMatchObject({
    eligible: false,
    reason,
    requestedAmount: 0,
    status: "ineligible",
  });
});

test("snoozing uses the selected month and only a true entry excludes it", () => {
  const value = input();
  value.category.target.snoozeSchedule = { "2026-09": true, "2026-10": false, october: true };
  expect(calculateTargetDemand(value).requestedAmount).toBe(800);
  value.category.target.snoozeSchedule["2026-10"] = true;
  expect(calculateTargetDemand(value)).toMatchObject({
    eligible: false,
    reason: "snoozed",
    requestedAmount: 0,
  });
});

test("no target and nonpositive amounts are ineligible rather than one-unit requests", () => {
  const value = input();

  for (const amount of [0, -10]) {
    value.category.target.amount = amount;
    expect(calculateTargetDemand(value)).toMatchObject({
      reason: "nonpositive-target-amount",
      requestedAmount: 0,
      status: "ineligible",
    });
  }

  expect(
    calculateTargetDemand({ ...value, category: { ...value.category, target: null } })
  ).toMatchObject({ reason: "no-target", requestedAmount: 0 });
});

test.each(["GET_OUT_OF_DEBT", "FUTURE_TYPE"])(
  "unsupported target type %s never becomes a fabricated zero demand",
  (type) => {
    const value = input();
    value.category.target.type = type;
    expect(calculateTargetDemand(value)).toMatchObject({
      eligible: false,
      reason: "unsupported-target-type",
      requestedAmount: null,
      status: "unsupported",
    });
  }
);

test.each([null, "WEEKLY", "FUTURE"])(
  "unsupported spending schedule %s never uses monthly arithmetic",
  (period) => {
    const value = input();
    value.category.target = { ...value.category.target, period, type: "SPENDING" };
    expect(calculateTargetDemand(value)).toMatchObject({
      reason: "unsupported-target-period",
      requestedAmount: null,
      status: "unsupported",
    });
  }
);

test.each([
  "type",
  "amountComputationStrategy",
  "accumulationStrategy",
  "carryOverStrategy",
] as const)("unknown category %s does not silently act like the default", (field) => {
  const value = input();
  value.category[field] = "UNKNOWN";
  expect(calculateTargetDemand(value)).toMatchObject({
    requestedAmount: null,
    status: "unsupported",
  });
});

test("unknown target carryover and ongoing schedule are explicit unsupported inputs", () => {
  const value = input();
  value.category.target.carryOverStrategy = "UNKNOWN";
  expect(calculateTargetDemand(value).status).toBe("unsupported");
  value.category.target.carryOverStrategy = "ALL";
  value.category.target.period = "UNKNOWN";
  expect(calculateTargetDemand(value).status).toBe("unsupported");
});

test.each([0.5, Number.MAX_SAFE_INTEGER + 1])(
  "unsafe consumed number %s is rejected in every numeric input",
  (invalid) => {
    const base = input();

    const cases = [
      { ...base, balance: { ...base.balance, allocatedAmount: invalid } },
      { ...base, balance: { ...base.balance, carriedOverAmount: invalid } },
      { ...base, directChildren: [{ allocatedAmount: invalid }] },
      ...["amount", "dayOfMonth", "dayOfWeekOrdinal"].map((field) => ({
        ...base,
        category: { ...base.category, target: { ...base.category.target, [field]: invalid } },
      })),
    ];

    for (const value of cases) {
      expect(() => calculateTargetDemand(value)).toThrow();
    }
  }
);

test("missing normalized operands and flags are rejected rather than defaulted", () => {
  const value = input();

  const malformed = [
    { ...value, balance: {} },
    { ...value, directChildren: undefined },
    { ...value, yearMonth: "" },
    { ...value, yearMonth: "october" },
    { ...value, yearMonth: "2026-13" },
    { ...value, category: { ...value.category, aggregateAllocationForTarget: undefined } },
    { ...value, category: { ...value.category, target: {} } },
    {
      ...value,
      category: {
        ...value.category,
        target: { ...value.category.target, useAllocatedAmountOnly: undefined },
      },
    },
  ];

  for (const bad of malformed) {
    // Exercise unvalidated callers without relaxing the public normalized input type.
    // @ts-expect-error Deliberately missing required normalized fields.
    expect(() => calculateTargetDemand(bad)).toThrow();
  }
});

test("BigInt intermediates retain a one-unit remainder after large child-sum cancellation", () => {
  const value = input();
  value.category.aggregateAllocationForTarget = true;
  value.category.target.amount = 3;
  value.balance.allocatedAmount = -9_007_199_254_740_991;
  value.directChildren = [{ allocatedAmount: 9_007_199_254_740_991 }, { allocatedAmount: 2 }];
  expect(calculateTargetDemand(value).requestedAmount).toBe(1);
});

test("unsafe final demand is rejected and oversized funding can still clamp exactly to zero", () => {
  const value = input();
  value.category.target.amount = Number.MAX_SAFE_INTEGER;
  value.balance.allocatedAmount = -1;
  expect(() => calculateTargetDemand(value)).toThrow();
  value.balance.allocatedAmount = Number.MAX_SAFE_INTEGER;
  value.category.aggregateAllocationForTarget = true;
  value.directChildren = [{ allocatedAmount: Number.MAX_SAFE_INTEGER }];
  expect(calculateTargetDemand(value).requestedAmount).toBe(0);
});
