import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { captureExecute } from "@crustjs/testing";

import type { Session } from "../auth/session.ts";
import { createApp } from "../cli/app.ts";
import type { Fetcher } from "../firestore/client.ts";
import { BeyondClient } from "../firestore/client.ts";
import { encodeFields } from "../firestore/encoding.ts";
import type { Data } from "../firestore/encoding.ts";
import { previewSmartAllocation, previewTargetAllocation } from "./auto-allocation.ts";

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

  const fetcher: Fetcher = (input, init) => {
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
  };

  const client = new BeyondClient(session, { fetcher });

  return { budget, categories, client, documents, fetcher, groups, methods, period, session, user };
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
  categories.first = {
    groupId: "living",
    id: "first",
    order: 10,
    target: { amount: 900, dayOfMonth: 1, dayOfWeek: "TUESDAY", period: "MONTHLY" },
  };
  categories.later = {
    groupId: "living",
    id: "later",
    order: 20,
    target: { amount: 600, dayOfMonth: 31, dayOfWeek: "MONDAY", type: "ON_GOING_SAVINGS" },
  };
  const plan = await previewTargetAllocation(client, "2026-10", now);
  expect(plan.categories[0]).toMatchObject({ afterAmount: 600, amount: 700, categoryId: "later" });
  categories.later = {
    groupId: "living",
    id: "later",
    order: 5,
    target: { amount: 600, dayOfMonth: 31, dayOfWeek: "TUESDAY", type: "ON_GOING_SAVINGS" },
  };
  const sameWeekday = await previewTargetAllocation(client, "2026-10", now);
  expect(sameWeekday.categories[0]).toMatchObject({ amount: 600, categoryId: "first" });
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

test("savings preview preserves stored timestamps and uses the explicit calculation timezone", async () => {
  const { client, categories, methods } = fixture();
  categories.later = {
    groupId: "living",
    id: "later",
    order: 20,
    target: {
      amount: 1200,
      createdAt: "2026-09-01T00:00:00Z",
      endAt: "2026-12-31T00:00:00Z",
      type: "SAVINGS",
    },
  };

  const plan = await previewTargetAllocation(client, "2026-10", now, {
    calculationTimezone: "UTC",
  });

  expect(plan.categories.find((c) => c.categoryId === "later")).toMatchObject({
    afterAmount: 300,
    amount: 400,
    beforeAmount: -100,
    requestedAmount: 700,
  });
  expect(plan).toMatchObject({ calculationTimezone: "UTC", executionSupported: false });
  await expect(previewTargetAllocation(client, "2026-10", now)).rejects.toThrow();
  expect(methods.every((m) => m === "GET")).toBe(true);
});

const smartFixture = () => {
  const data = fixture();
  data.budget.stashIdentifiers = {
    GROUPS_AND_CATEGORIES: "categories",
    TRANSACTIONS: "transactions",
  };
  data.documents.set(`${budgetPath}/stashes/transactions`, {
    data: { trimmed: false, upcomingTransactions: {} },
  });
  data.period.balances = {
    first: { allocatedAmount: 200, carriedOverAmount: 100 },
    later: { allocatedAmount: -100 },
  };

  return data;
};

test("smart preview funds overspending once and leaves the original target request suppressed", async () => {
  const { client, methods } = smartFixture();
  const plan = await previewSmartAllocation(client, "2026-10", now);
  expect(plan).toMatchObject({
    allocatedAmount: 700,
    executionSupported: false,
    remainingAmount: 300,
    strategy: "smart",
  });
  expect(plan.categories.find((c) => c.categoryId === "later")).toMatchObject({
    afterAmount: 0,
    amount: 100,
    fundedPhase: "overspending",
    targetRequest: 700,
  });
  expect(plan.categories.find((c) => c.categoryId === "first")).toMatchObject({
    afterAmount: 800,
    amount: 600,
    fundedPhase: "targets",
  });
  expect(plan.phases[1]?.categories.some((c) => c.categoryId === "later")).toBe(false);
  expect(plan.sources).toHaveLength(5);
  expect(methods.every((m) => m === "GET")).toBe(true);
});

test("smart preview admits overspending without a target and prioritizes the larger deficit", async () => {
  const { client, categories, period } = smartFixture();
  categories.first = { groupId: "living", id: "first", order: 10 };
  period.balances = { first: { allocatedAmount: -200 }, later: { allocatedAmount: -100 } };
  period.allocationAmount = -150;
  period.allocationCarriedOverAmount = 0;
  const plan = await previewSmartAllocation(client, "2026-10", now);
  expect(plan.categories[0]).toMatchObject({
    afterAmount: -50,
    amount: 150,
    categoryId: "first",
    eligible: true,
  });
  expect(plan.categories.find((c) => c.categoryId === "later")?.amount).toBe(0);
  expect(plan.phases[1]?.categories.some((c) => c.categoryId === "first")).toBe(false);
});

test("smart preview can fund a smaller target after skipping unaffordable overspending", async () => {
  const { client, categories, period, user } = smartFixture();
  user.config = { allowPartialAllocationEnabled: false, timezone: "UTC" };
  categories.first = {
    carryOverStrategy: "NONE",
    groupId: "living",
    id: "first",
    order: 10,
    target: { amount: 250, period: "MONTHLY" },
  };
  categories.later = { groupId: "living", id: "later", order: 20 };
  period.balances = { first: { allocatedAmount: 200, spentAmount: 400 }, later: {} };
  period.allocationAmount = 200;
  const plan = await previewSmartAllocation(client, "2026-10", now);
  expect(plan).toMatchObject({ allocatedAmount: 50, remainingAmount: 50 });
  expect(plan.categories[0]).toMatchObject({
    afterAmount: 250,
    amount: 50,
    categoryId: "first",
    fundedPhase: "targets",
    overspendingRequest: 200,
    targetRequest: 50,
  });
});

test.each([
  { amount: 0, type: "ON_GOING_SAVINGS" },
  { amount: -1, period: "WEEKLY", type: "SPENDING" },
])(
  "smart preview rejects nonpositive targets before overspending admits them: %j",
  async (target) => {
    const { client, categories, period, user, methods } = smartFixture();
    user.config = { allowPartialAllocationEnabled: false, timezone: "UTC" };
    categories.first = { groupId: "living", id: "first", order: 10, target };
    categories.later = { groupId: "living", id: "later", order: 20 };
    period.balances = { first: { allocatedAmount: -10, spentAmount: 90 } };
    period.allocationAmount = 0;
    period.allocationCarriedOverAmount = 0;

    await expect(previewSmartAllocation(client, "2026-10", now)).rejects.toThrow(
      "Smart preview does not support nonpositive targets"
    );
    expect(methods.every((method) => method === "GET")).toBe(true);
  }
);

test("smart preview refuses unknown upcoming inputs and unsupported smart eligibility", async () => {
  const changes = [
    (data: ReturnType<typeof smartFixture>) =>
      data.documents.delete(`${budgetPath}/stashes/transactions`),
    (data: ReturnType<typeof smartFixture>) =>
      data.documents.set(`${budgetPath}/stashes/transactions`, { data: { trimmed: true } }),
    (data: ReturnType<typeof smartFixture>) =>
      data.documents.set(`${budgetPath}/stashes/transactions`, {
        data: { upcomingTransactions: { bill: { targetToId: "first" } } },
      }),
    (data: ReturnType<typeof smartFixture>) => {
      data.period.balances = { orphan: { upcomingAmount: 1 } };
    },
    (data: ReturnType<typeof smartFixture>) => {
      data.categories.first = {
        accumulationStrategy: "FUND_OVERRUNS",
        groupId: "living",
        id: "first",
        order: 10,
      };
    },
    (data: ReturnType<typeof smartFixture>) => {
      data.categories.first = {
        groupId: "living",
        id: "first",
        order: 10,
        target: { amount: 100, period: "MONTHLY", snoozeSchedule: { "2026-10": true } },
      };
    },
  ];

  await Promise.all(
    changes.map(async (change) => {
      const data = smartFixture();
      change(data);
      await expect(previewSmartAllocation(data.client, "2026-10", now)).rejects.toThrow();
      expect(data.methods.every((m) => m === "GET")).toBe(true);
    })
  );
});

test("CLI selects smart planning and passes an explicit savings timezone without financial writes", async () => {
  const data = smartFixture();
  const month = new Date().toISOString().slice(0, 7);
  data.budget.availablePeriods = { [month]: { id: "october" } };
  data.period.yearMonth = month;
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-allocation-cli-"));
  const previous = process.env.BEBU_SESSION_FILE;

  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(data.fetcher, { preconnect: fetch.preconnect })
  );

  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    await writeFile(process.env.BEBU_SESSION_FILE, JSON.stringify(data.session));

    const smart = await captureExecute(createApp(), [
      "allocations",
      "preview",
      "--month",
      month,
      "--strategy",
      "smart",
    ]);

    expect(smart.exitCode).toBe(0);
    expect(JSON.parse(smart.stdout)).toMatchObject({
      allocatedAmount: 700,
      executionSupported: false,
      strategy: "smart",
    });
    data.categories.later = {
      groupId: "living",
      id: "later",
      order: 20,
      target: { amount: 1200, createdAt: "2020-01-01T00:00:00Z", type: "SAVINGS" },
    };

    const savings = await captureExecute(createApp(), [
      "allocations",
      "preview",
      "--month",
      month,
      "--calculation-timezone",
      "UTC",
    ]);

    expect(savings.exitCode).toBe(0);
    expect(JSON.parse(savings.stdout)).toMatchObject({
      calculationTimezone: "UTC",
      categories: expect.arrayContaining([
        expect.objectContaining({ categoryId: "later", requestedAmount: 1300 }),
      ]),
      strategy: "targets",
    });

    const unsupported = await captureExecute(createApp(), [
      "allocations",
      "preview",
      "--month",
      month,
      "--strategy",
      "unknown",
    ]);

    expect(unsupported.exitCode).toBe(1);
    expect(data.methods.every((m) => m === "GET")).toBe(true);
  } finally {
    fetchMock.mockRestore();

    if (previous === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previous;
    }

    await rm(directory, { force: true, recursive: true });
  }
});

test("smart excludes income and skipped deficits and honors NONE carryover", async () => {
  const { client, categories, period } = smartFixture();
  categories.first = { carryOverStrategy: "NONE", groupId: "living", id: "first", order: 10 };
  period.balances = {
    first: { allocatedAmount: 0, carriedOverAmount: -500 },
    later: { allocatedAmount: -100 },
    salary: { allocatedAmount: -50_000 },
    skipped: { allocatedAmount: -9000 },
  };
  const plan = await previewSmartAllocation(client, "2026-10", now);
  expect(plan.allocatedAmount).toBe(100);
  expect(plan.categories.filter((c) => c.amount > 0).map((c) => c.categoryId)).toEqual(["later"]);
  period.allocationAmount = -500;
  const empty = await previewSmartAllocation(client, "2026-10", now);
  expect(empty).toMatchObject({ allocatedAmount: 0, availableAmount: -300, remainingAmount: -300 });
});
