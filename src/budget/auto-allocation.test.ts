import { expect, test } from "bun:test";

import type { Session } from "../auth/session.ts";
import { BeyondClient } from "../firestore/client.ts";
import { encodeFields } from "../firestore/encoding.ts";
import type { Data } from "../firestore/encoding.ts";
import { previewTargetAllocation } from "./auto-allocation.ts";

const root = "projects/beyond-budget/databases/(default)/documents";
const budgetPath = `${root}/budgets/example`;
const now = new Date("2026-10-23T00:00:00Z");
const stamp = "2026-10-01T00:00:00Z";

const fixture = () => {
  const categories: Data = {
    first: {
      groupId: "living",
      id: "first",
      order: 10,
      target: { amount: 900, period: "MONTHLY" },
    },
    later: {
      groupId: "living",
      id: "later",
      order: 20,
      target: { amount: 600, type: "ON_GOING_SAVINGS" },
    },
    salary: { groupId: "income", id: "salary", type: "INCOME" },
    skipped: { amountComputationStrategy: "SKIP", groupId: "living", id: "skipped", order: 30 },
  };

  const groups: Data = {
    income: { id: "income", order: 0, type: "INCOME" },
    living: { id: "living", order: 1 },
  };

  const period: Data = {
    allocationAmount: 1000,
    allocationCarriedOverAmount: 100,
    balances: {
      first: { allocatedAmount: 200, carriedOverAmount: 100, upcomingAmount: 999 },
      later: { allocatedAmount: -100 },
      salary: { allocatedAmount: 50_000 },
      skipped: { allocatedAmount: 9000 },
    },
    id: "october",
    yearMonth: "2026-10",
  };

  const user: Data = { config: { timezone: "UTC" } };

  const budget: Data = {
    availablePeriods: { "2026-10": { id: "october" } },
    id: "example",
    stashIdentifiers: { GROUPS_AND_CATEGORIES: "categories" },
    type: "ZERO_BASED",
  };

  const documents = new Map<string, Data>([
    [budgetPath, budget],
    [`${budgetPath}/stashes/categories`, { data: { categories, groups } }],
    [`${budgetPath}/periods/october`, period],
    [`${root}/users/reader`, user],
  ]);

  const session: Session = {
    budgetIds: ["example"],
    expiresAt: Date.now() + 3_600_000,
    idToken: "synthetic",
    importedAt: stamp,
    projectId: "beyond-budget",
    stashes: [],
    uid: "reader",
    version: 1,
  };

  const methods: string[] = [];

  const client = new BeyondClient(session, {
    fetcher: (input, init) => {
      const path = new URL(String(input)).pathname.slice(4);
      methods.push(init?.method ?? "GET");

      if (init?.method !== "GET") {
        throw new Error("Allocation preview attempted a write");
      }

      const data = documents.get(path);

      return Promise.resolve(
        data
          ? Response.json({ fields: encodeFields(data), name: path, updateTime: stamp })
          : Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 })
      );
    },
  });

  return { budget, categories, client, documents, groups, methods, period, user };
};

test("target preview computes the signed pool and sequential funding from saved defaults and order", async () => {
  const { client, methods } = fixture();
  const plan = await previewTargetAllocation(client, "2026-10", now);
  expect(plan.pool).toEqual({
    allocatedAmount: 100,
    allocationAmount: 1000,
    allocationCarriedOverAmount: 100,
    availableAmount: 1000,
  });
  expect(
    plan.categories.map(({ categoryId, beforeAmount, afterAmount, amount, requestedAmount }) => ({
      afterAmount,
      amount,
      beforeAmount,
      categoryId,
      requestedAmount,
    }))
  ).toEqual([
    {
      afterAmount: 50_000,
      amount: 0,
      beforeAmount: 50_000,
      categoryId: "salary",
      requestedAmount: 0,
    },
    { afterAmount: 800, amount: 600, beforeAmount: 200, categoryId: "first", requestedAmount: 600 },
    {
      afterAmount: 300,
      amount: 400,
      beforeAmount: -100,
      categoryId: "later",
      requestedAmount: 700,
    },
    { afterAmount: 9000, amount: 0, beforeAmount: 9000, categoryId: "skipped", requestedAmount: 0 },
  ]);
  expect(plan).toMatchObject({
    allocatedAmount: 1000,
    executionSupported: false,
    remainingAmount: 0,
    settings: { allowPartial: true, ignoreAvailable: false, overwrite: false },
    shortfallAmount: 300,
  });
  expect(plan.sources).toHaveLength(4);
  expect(methods.every((method) => method === "GET")).toBe(true);
});

test("stored partial false skips an unaffordable target and snoozing removes its competing demand", async () => {
  const { client, user, categories } = fixture();
  user.config = { allowPartialAllocationEnabled: false, timezone: "UTC" };
  const plan = await previewTargetAllocation(client, "2026-10", now);
  expect(plan).toMatchObject({ allocatedAmount: 600, remainingAmount: 400, shortfallAmount: 700 });
  categories.first = {
    groupId: "living",
    id: "first",
    order: 10,
    target: { amount: 900, period: "MONTHLY", snoozeSchedule: { "2026-10": true } },
  };
  const snoozed = await previewTargetAllocation(client, "2026-10", now);
  expect(snoozed).toMatchObject({ allocatedAmount: 700, remainingAmount: 300, shortfallAmount: 0 });
  expect(snoozed.categories.find((category) => category.categoryId === "first")?.reason).toBe(
    "snoozed"
  );
});

test("target date priority precedes stored order and an overallocated pool funds nothing", async () => {
  const { client, categories, period } = fixture();
  categories.later = {
    groupId: "living",
    id: "later",
    order: 20,
    target: { amount: 600, dayOfMonth: 1, type: "ON_GOING_SAVINGS" },
  };
  const plan = await previewTargetAllocation(client, "2026-10", now);
  expect(plan.categories[0]).toMatchObject({ afterAmount: 600, amount: 700, categoryId: "later" });
  period.allocationAmount = -100;
  const empty = await previewTargetAllocation(client, "2026-10", now);
  expect(empty.pool.availableAmount).toBe(-100);
  expect(empty.availableAmount).toBe(-100);
  expect(empty.allocatedAmount).toBe(0);
  expect(empty.remainingAmount).toBe(-100);
});

test("unsupported formulas and uncertain input cannot produce an incomplete allocation plan", async () => {
  const changes = [
    ({ categories }: ReturnType<typeof fixture>) => {
      categories.later = { groupId: "living", id: "later", order: 10 };
    },
    ({ categories }: ReturnType<typeof fixture>) => {
      categories.later = {
        groupId: "living",
        id: "later",
        order: 20,
        target: { amount: 1000, type: "SAVINGS" },
      };
    },
    ({ categories }: ReturnType<typeof fixture>) => {
      categories.later = { groupId: "living", id: "later", order: 20, parentCategoryId: "first" };
    },
    ({ categories }: ReturnType<typeof fixture>) => {
      categories.later = { groupId: "living", id: "wrong", order: 20 };
    },
    ({ categories }: ReturnType<typeof fixture>) => {
      categories.later = { groupId: "missing", id: "later", order: 20 };
    },
    ({ categories }: ReturnType<typeof fixture>) => {
      categories.later = {
        groupId: "living",
        id: "later",
        linkedAccountIds: ["savings"],
        order: 20,
      };
    },
    ({ categories }: ReturnType<typeof fixture>) => {
      categories.later = { archived: true, groupId: "living", id: "later", order: 20 };
    },
    ({ groups }: ReturnType<typeof fixture>) => {
      groups.living = { id: "living", order: 1, type: "DEBT_PAYMENT" };
    },
    ({ categories }: ReturnType<typeof fixture>) => {
      categories.later = {
        amountComputationStrategy: "FUTURE",
        groupId: "living",
        id: "later",
        order: 20,
      };
    },
    ({ user }: ReturnType<typeof fixture>) => {
      user.config = { ignorePendingAllocationAmountEnabled: true, timezone: "UTC" };
    },
    ({ period }: ReturnType<typeof fixture>) => {
      period.allocationAmount = Number.MAX_SAFE_INTEGER + 1;
    },
    ({ period }: ReturnType<typeof fixture>) => {
      period.yearMonth = "2026-09";
    },
    ({ budget }: ReturnType<typeof fixture>) => {
      budget.availablePeriods = { "2026-10": { id: "october" }, "2026-11": { id: "next" } };
    },
    ({ documents }: ReturnType<typeof fixture>) => {
      documents.delete(`${root}/users/reader`);
    },
  ];

  await Promise.all(
    changes.map(async (change) => {
      const data = fixture();
      change(data);
      await expect(previewTargetAllocation(data.client, "2026-10", now)).rejects.toThrow();
      expect(data.methods.every((method) => method === "GET")).toBe(true);
    })
  );
});
