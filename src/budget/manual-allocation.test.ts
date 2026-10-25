/* oxlint-disable func-style -- Named domain functions follow the repository TypeScript conventions. */
import { expect, test } from "bun:test";

import { calculateManualAllocation } from "./manual-allocation.ts";

function fixture() {
  return {
    accounts: {
      savings: {
        archived: false,
        balanceAmount: 1200,
        currencyCode: "",
        id: "savings",
        linkedCategoryId: "fund",
        name: "Savings",
        type: "SAVINGS",
        unclearedBalanceAmount: 50,
      },
    },
    categoryId: "fund",
    currencyCode: "PHP",
    index: {
      categories: {
        card: { groupId: "cards", id: "card", systemGenerated: true, type: "CREDIT_CARD_PAYMENT" },
        child: { groupId: "living", id: "child", parentCategoryId: "parent" },
        fund: {
          accumulationStrategy: "FUND_OVERRUNS",
          groupId: "living",
          id: "fund",
          linkedAccountIds: ["savings"],
        },
        parent: { groupId: "living", id: "parent" },
        salary: { groupId: "income", id: "salary", type: "INCOME" },
        skipped: { amountComputationStrategy: "SKIP", groupId: "living", id: "skipped" },
      },
      groups: {
        cards: { id: "cards", systemGenerated: true, type: "DEBT_PAYMENT" },
        income: { id: "income", type: "INCOME" },
        living: { id: "living" },
      },
    },
    period: {
      allocationAmount: 2000,
      allocationCarriedOverAmount: 100,
      balances: {
        card: { allocatedAmount: 75, otherAmount: 9999 },
        child: { allocatedAmount: -25 },
        fund: { allocatedAmount: 200, carriedOverAmount: 700, otherAmount: 20, spentAmount: 50 },
        parent: { allocatedAmount: 100 },
        salary: { allocatedAmount: 50_000 },
        skipped: { allocatedAmount: 8000 },
      },
      id: "october",
      yearMonth: "2026-10",
    },
  };
}

test("manual signed allocation counts hierarchy and payment allocations once without target exclusions", () => {
  const plan = calculateManualAllocation(fixture(), { amount: -300 });
  expect(plan.before).toEqual({ allocation: 200, available: 870, pool: 1750 });
  expect(plan.after).toEqual({ allocation: -300, available: 370, pool: 2250 });
  expect(plan.delta).toBe(-500);
  expect(plan.history).toEqual({ overallocationAmount: 0, overallocationStatus: "NONE" });
});

test("account matching uses cleared money and all availability operands", () => {
  const plan = calculateManualAllocation(fixture(), { matchLinked: true });
  expect(plan.after.allocation).toBe(530);
  expect(plan.after.available).toBe(1200);
  expect(plan.links[0]).toMatchObject({ id: "savings", unclearedBalanceAmount: 50 });
});

test("archived zero orphan links are reported and preserved while contradictory links fail", () => {
  const input = fixture();
  Object.assign(input.accounts, {
    old: {
      archived: true,
      balanceAmount: 0,
      currencyCode: "",
      id: "old",
      linkedCategoryId: "",
      type: "SAVINGS",
      unclearedBalanceAmount: 0,
    },
  });
  input.index.categories.fund.linkedAccountIds.push("old");
  expect(calculateManualAllocation(input, { amount: 100 }).links[1]).toMatchObject({
    id: "old",
    status: "archived-zero-orphan",
  });
  input.accounts.savings.linkedCategoryId = "child";
  expect(() => calculateManualAllocation(input, { amount: 100 })).toThrow("link");
});

test("manual planner rejects pool overdrafts, unsafe arithmetic, parents and unknown strategies", () => {
  expect(() => calculateManualAllocation(fixture(), { amount: 20_000 })).toThrow("available funds");
  const overflow = fixture();
  overflow.period.allocationAmount = Number.MAX_SAFE_INTEGER;
  overflow.period.allocationCarriedOverAmount = 10_000;
  expect(() => calculateManualAllocation(overflow, { amount: 0 })).toThrow();
  const parent = fixture();
  parent.categoryId = "parent";
  expect(() => calculateManualAllocation(parent, { amount: 0 })).toThrow("parent");
  const broken = fixture();
  broken.index.categories.child.parentCategoryId = "missing";
  expect(() => calculateManualAllocation(broken, { amount: 0 })).toThrow("hierarchy");
});

test("no-change allocations are explicit and reductions remain valid when the pool is already negative", () => {
  expect(calculateManualAllocation(fixture(), { amount: 200 }).noChange).toBe(true);
  const input = fixture();
  input.period.allocationAmount = 200;
  const result = calculateManualAllocation(input, { amount: 100 });
  expect(result.history).toEqual({ overallocationAmount: 0, overallocationStatus: "FIXED" });
});

test("manual arithmetic reproduces all nine sanitized deployed before-and-after fixtures", async () => {
  const { readFile } = await import("node:fs/promises");
  const { z } = await import("zod");

  const schema = z.object({
    cases: z.array(
      z.object({
        after: z.object({
          current: z.object({ categoryBalance: z.object({ allocatedAmount: z.number() }) }),
        }),
        before: z.object({
          accounts: z.record(z.string(), z.unknown()),
          categorySettings: z.object({
            accumulationStrategy: z.string().nullish(),
            carryOverStrategy: z.string().nullish(),
            linkedAccountIds: z.array(z.string()).nullish(),
          }),
          current: z.object({
            allocationAmount: z.number(),
            allocationCarriedOverAmount: z.number(),
            categoryBalance: z.object({
              allocatedAmount: z.number(),
              carriedOverAmount: z.number(),
              otherAmount: z.number(),
              spentAmount: z.number(),
            }),
          }),
        }),
        category: z.string(),
      })
    ),
  });

  const fixtureFile = new URL(
    "../../docs/beyond-budget/fixtures/allocation-writes-2026-10-25.json",
    import.meta.url
  );

  const evidence = schema.parse(JSON.parse(await readFile(fixtureFile, "utf-8")));

  const expected = [
    { after: 90_000, before: 100_000, other: 0 },
    { after: 80_000, before: 90_000, other: 0 },
    { after: 105_000, before: 80_000, other: 0 },
    { after: 87_500, before: 85_000, other: 15_000 },
    { after: 85_000, before: 87_500, other: 15_000 },
    { after: 84_900, before: 85_000, other: 15_000 },
    { after: 80_000, before: 87_500, other: 15_000 },
    { after: 34_100, before: 79_200, other: 15_800 },
    { after: 79_000, before: 79_100, other: 15_800 },
  ];

  expect(evidence.cases).toHaveLength(expected.length);

  for (const [offset, captured] of evidence.cases.entries()) {
    const amounts = expected[offset];

    if (!amounts) {
      throw new Error("Missing literal fixture expectations");
    }

    const id = captured.category;

    const accounts = Object.fromEntries(
      Object.entries(captured.before.accounts).map(([key, value]) => [
        key,
        { ...z.record(z.string(), z.unknown()).parse(value), id: key },
      ])
    );

    const result = calculateManualAllocation(
      {
        accounts,
        categoryId: id,
        currencyCode: "PHP",
        index: {
          categories: {
            [id]: {
              accumulationStrategy:
                captured.before.categorySettings.accumulationStrategy ?? "DEFAULT",
              carryOverStrategy: captured.before.categorySettings.carryOverStrategy ?? "ALL",
              groupId: "living",
              id,
              linkedAccountIds: captured.before.categorySettings.linkedAccountIds ?? [],
            },
            other: { groupId: "living", id: "other" },
          },
          groups: { living: { id: "living" } },
        },
        period: {
          allocationAmount: captured.before.current.allocationAmount,
          allocationCarriedOverAmount: captured.before.current.allocationCarriedOverAmount,
          balances: {
            [id]: captured.before.current.categoryBalance,
            other: { allocatedAmount: amounts.other },
          },
          id: "current-period",
          yearMonth: "2026-10",
        },
      },
      { amount: captured.after.current.categoryBalance.allocatedAmount }
    );

    expect(result.before.pool).toBe(amounts.before);
    expect(result.after.pool).toBe(amounts.after);
  }
});
