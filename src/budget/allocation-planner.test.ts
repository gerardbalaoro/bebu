import { expect, test } from "bun:test";

import { distributeAllocation } from "./allocation-planner.ts";

test("partial allocation exhausts the pool in order instead of distributing proportionally", () => {
  const plan = distributeAllocation(
    150,
    [
      { categoryId: "rent", requestedAmount: 200 },
      { categoryId: "food", requestedAmount: 100 },
    ],
    true
  );

  expect(plan).toEqual({
    allocatedAmount: 150,
    availableAmount: 150,
    categories: [
      {
        amount: 150,
        categoryId: "rent",
        requestedAmount: 200,
        shortfallAmount: 50,
        status: "partial",
      },
      {
        amount: 0,
        categoryId: "food",
        requestedAmount: 100,
        shortfallAmount: 100,
        status: "insufficient-funds",
      },
    ],
    remainingAmount: 0,
    requestedAmount: 300,
    shortfallAmount: 150,
  });
});

test("without partial allocation an unaffordable category does not block a later affordable one", () => {
  const plan = distributeAllocation(
    150,
    [
      { categoryId: "rent", requestedAmount: 200 },
      { categoryId: "food", requestedAmount: 100 },
    ],
    false
  );

  expect(plan.remainingAmount).toBe(50);
  expect(plan.allocatedAmount).toBe(100);
  expect(plan.categories.map(({ amount, status }) => ({ amount, status }))).toEqual([
    { amount: 0, status: "insufficient-funds" },
    { amount: 100, status: "funded" },
  ]);
});

test("negative requests cannot release money into the remaining allocation pool", () => {
  const plan = distributeAllocation(
    100,
    [
      { categoryId: "alreadyFunded", requestedAmount: -200 },
      { categoryId: "food", requestedAmount: 150 },
    ],
    true
  );

  expect(plan.categories.map(({ amount }) => amount)).toEqual([0, 100]);
  expect(plan.requestedAmount).toBe(150);
  expect(plan.shortfallAmount).toBe(50);
});

test("unsafe amounts and duplicate category requests fail instead of returning an ambiguous plan", () => {
  expect(() => distributeAllocation(0.5, [], true)).toThrow();
  expect(() => distributeAllocation(-1, [], true)).toThrow();
  expect(() =>
    distributeAllocation(
      10,
      [{ categoryId: "x", requestedAmount: Number.MAX_SAFE_INTEGER + 1 }],
      true
    )
  ).toThrow();
  expect(() =>
    distributeAllocation(
      10,
      [
        { categoryId: "x", requestedAmount: 1 },
        { categoryId: "x", requestedAmount: 2 },
      ],
      true
    )
  ).toThrow();
  expect(() =>
    distributeAllocation(
      10,
      [
        { categoryId: "x", requestedAmount: Number.MAX_SAFE_INTEGER },
        { categoryId: "y", requestedAmount: 1 },
      ],
      true
    )
  ).toThrow();
});
