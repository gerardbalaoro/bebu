import { expect, test } from "bun:test";

import type { Session } from "../auth/session.ts";
import { BeyondClient } from "../firestore/client.ts";
import { encodeFields } from "../firestore/encoding.ts";
import type { Data } from "../firestore/encoding.ts";
import { categoryTargets } from "./targets.ts";

const budgetPath = "projects/beyond-budget/databases/(default)/documents/budgets/targetFixture";
const timestamp = "2026-10-01T00:00:00.000Z";
const categoryPath = `${budgetPath}/stashes/categories`;
const periodPath = `${budgetPath}/periods/october`;

const target = {
  amount: 20_000,
  carryOverStrategy: "FUTURE_TARGET_STRATEGY",
  createdAt: timestamp,
  dayOfMonth: 23,
  dayOfWeek: null,
  dynamicSavingsTarget: false,
  endAt: null,
  monthOfYear: null,
  period: "FUTURE_PERIOD",
  repeatIntervalMonths: null,
  snoozeSchedule: { "2026-10": { future: true } },
  type: "ON_GOING_SAVINGS",
  unknownSetting: ["preserved"],
  useAllocatedAmountOnly: true,
};

const fixture = () => {
  const session: Session = {
    budgetIds: ["targetFixture"],
    expiresAt: Date.now() + 3_600_000,
    idToken: "synthetic-token",
    importedAt: timestamp,
    projectId: "beyond-budget",
    stashes: [],
    uid: "synthetic-user",
    version: 1,
  };

  const category: Data = {
    aggregateAllocationForTarget: "UNKNOWN_SETTING",
    carryOverStrategy: "FUTURE_CATEGORY_STRATEGY",
    id: "storedId",
    linkedAccountIds: ["savings"],
    name: "Reserve",
    target: structuredClone(target),
    type: "DEFAULT",
  };

  const categories: Data = {
    noTarget: { id: "noTarget", type: "DEFAULT" },
    nullTarget: { id: "nullTarget", target: null },
    reserve: category,
  };

  const balance: Data = {
    allocatedAmount: -100,
    carriedOverAmount: 1000,
    futureBalanceField: true,
    otherAmount: 300,
    spentAmount: 200,
    upcomingAmount: 500,
  };

  const balances: Data = { reserve: balance };
  const period: Data = { balances };

  const documents = new Map<string, Data>([
    [
      budgetPath,
      {
        availablePeriods: { "2026-10": { id: "october" } },
        stashIdentifiers: { GROUPS_AND_CATEGORIES: "categories" },
      },
    ],
    [categoryPath, { data: { categories } }],
    [periodPath, period],
  ]);

  const requests: string[] = [];

  const client = new BeyondClient(session, {
    fetcher: (input, init) => {
      const path = new URL(String(input)).pathname.slice(4);
      requests.push(path);

      if (init?.method !== "GET") {
        throw new Error("Read-only targets attempted a write");
      }

      const data = documents.get(path);

      return Promise.resolve(
        data
          ? Response.json({ fields: encodeFields(data), name: path, updateTime: timestamp })
          : Response.json(
              { error: { message: "Missing fixture", status: "NOT_FOUND" } },
              { status: 404 }
            )
      );
    },
  });

  return { balance, balances, categories, category, client, documents, period, requests };
};

test("targets retain raw schedule, category links and conflicting carryover settings without calculating target progress", async () => {
  const { client, requests } = fixture();
  const result = await categoryTargets(client);
  expect(result.targets).toEqual([
    {
      category: {
        aggregateAllocationForTarget: "UNKNOWN_SETTING",
        carryOverStrategy: "FUTURE_CATEGORY_STRATEGY",
        id: "storedId",
        linkedAccountIds: ["savings"],
        name: "Reserve",
        target,
        type: "DEFAULT",
      },
      categoryId: "reserve",
      progress: { status: "not-calculated" },
      target,
    },
  ]);
  expect(result.sources).toEqual([
    { document: budgetPath, updateTime: timestamp },
    { document: categoryPath, updateTime: timestamp },
  ]);
  expect(requests).toEqual([budgetPath, categoryPath]);
});

test("month availability uses signed balances, excludes upcoming spending and never becomes target progress", async () => {
  const { client } = fixture();
  const result = await categoryTargets(client, { categoryId: "reserve", yearMonth: "2026-10" });
  expect(result.targets[0]).toMatchObject({
    categoryId: "reserve",
    month: {
      allocatedAmount: -100,
      availableAmount: 1000,
      balance: {
        allocatedAmount: -100,
        carriedOverAmount: 1000,
        futureBalanceField: true,
        otherAmount: 300,
        spentAmount: 200,
        upcomingAmount: 500,
      },
      missingFields: [],
      status: "available",
    },
    progress: { status: "not-calculated" },
  });
  expect(result).toMatchObject({ periodId: "october", yearMonth: "2026-10" });
  expect(result.sources[2]).toEqual({ document: periodPath, updateTime: timestamp });
});

test("missing balance components are explicit and never produce a fabricated available amount", async () => {
  const { client, balances } = fixture();
  balances.reserve = { allocatedAmount: 40, spentAmount: 10 };
  const incomplete = await categoryTargets(client, { yearMonth: "2026-10" });
  expect(incomplete.targets[0]?.month).toEqual({
    allocatedAmount: 40,
    availableAmount: null,
    balance: { allocatedAmount: 40, spentAmount: 10 },
    missingFields: ["carriedOverAmount", "otherAmount"],
    status: "incomplete-balance",
  });
  delete balances.reserve;
  const missing = await categoryTargets(client, { yearMonth: "2026-10" });
  expect(missing.targets[0]?.month).toEqual({
    allocatedAmount: null,
    availableAmount: null,
    balance: null,
    missingFields: ["allocatedAmount", "carriedOverAmount", "otherAmount", "spentAmount"],
    status: "missing-balance",
  });
});

test.each([null, "100", 0.5, Number.MAX_SAFE_INTEGER + 1])(
  "malformed money %s is rejected before returning computed availability",
  async (value) => {
    const { balance, client } = fixture();
    balance.otherAmount = value;
    await expect(categoryTargets(client, { yearMonth: "2026-10" })).rejects.toThrow();
  }
);

test("an unsafe availability total is rejected and exact safe cancellation is accepted", async () => {
  const { balance, client } = fixture();
  balance.allocatedAmount = Number.MAX_SAFE_INTEGER;
  balance.carriedOverAmount = 1;
  balance.otherAmount = 0;
  balance.spentAmount = 0;
  await expect(categoryTargets(client, { yearMonth: "2026-10" })).rejects.toThrow("safe integer");
  balance.spentAmount = 1;
  const result = await categoryTargets(client, { yearMonth: "2026-10" });
  expect(result.targets[0]?.month?.availableAmount).toBe(Number.MAX_SAFE_INTEGER);
});

test("malformed period balance maps are not silently treated as empty months", async () => {
  const { client, period } = fixture();
  delete period.balances;
  await expect(categoryTargets(client, { yearMonth: "2026-10" })).rejects.toThrow();
});

test("target filtering distinguishes nonexistent categories from categories without a target and uses stable map-key order", async () => {
  const { categories, client } = fixture();
  categories.a = { id: "different", target: { amount: "raw-value", type: "UNKNOWN" } };
  const all = await categoryTargets(client);
  expect(all.targets.map((entry) => entry.categoryId)).toEqual(["a", "reserve"]);
  const withoutTarget = await categoryTargets(client, { categoryId: "noTarget" });
  expect(withoutTarget.targets).toEqual([]);
  const selected = await categoryTargets(client, { categoryId: "a" });
  expect(selected.targets[0]?.target).toEqual({
    amount: "raw-value",
    type: "UNKNOWN",
  });
  await expect(categoryTargets(client, { categoryId: "missing" })).rejects.toThrow(
    "Category not found"
  );
});

test("invalid filters fail without reads and a missing month fails instead of selecting another month", async () => {
  const { client, requests } = fixture();
  await expect(categoryTargets(client, { yearMonth: "2026-00" })).rejects.toThrow();
  await expect(categoryTargets(client, { categoryId: "../escape" })).rejects.toThrow();
  expect(requests).toEqual([]);
  await expect(categoryTargets(client, { yearMonth: "2027-01" })).rejects.toThrow("does not exist");
});
