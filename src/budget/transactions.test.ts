import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { captureExecute } from "@crustjs/testing";
import { z } from "zod";

import type { Session } from "../auth/session.ts";
import { createApp } from "../cli/app.ts";
import { BeyondClient } from "../firestore/client.ts";
import type { Fetcher } from "../firestore/client.ts";
import { encodeFields } from "../firestore/encoding.ts";
import type { CommitResult, Data, Write } from "../firestore/encoding.ts";
import { AccountService } from "./accounts.ts";
import { budgetDiagnostics } from "./diagnostics.ts";
import { categoryFunding } from "./funding.ts";
import { TransactionService } from "./transactions.ts";

const budgetPath = "projects/beyond-budget/databases/(default)/documents/budgets/testBudget";
const transactionId = "AbCdEfGhIjKlMnOpQrSt";
const timestamp = "2026-10-01T00:00:00.000Z";

const session: Session = {
  budgetIds: ["testBudget"],
  expiresAt: Date.now() + 3_600_000,
  idToken: "test-token",
  importedAt: timestamp,
  projectId: "beyond-budget",
  stashes: [],
  uid: "testUser",
  version: 1,
};

const canonicalTransaction = {
  amount: -250,
  autoAllocateIfCapable: false,
  autoAllocateIfIncome: false,
  budgetId: "testBudget",
  cleared: true,
  clonedToTransactionId: null,
  color: "NONE",
  completed: true,
  createdAt: timestamp,
  createdBy: { displayName: "Test", email: null, photoUrl: "", uid: "testUser" },
  dueAt: timestamp,
  editable: true,
  eventId: null,
  externalId: null,
  extraTarget: null,
  extras: {},
  files: [],
  frequency: "ONE_OFF",
  id: transactionId,
  integrityCount: 1,
  latitude: null,
  longitude: null,
  nonWorkingDayPolicy: "KEEP_ORIGINAL_DATE",
  notes: "",
  offsetAdjustment: 0,
  payee: null,
  periodId: "periodOne",
  reconciled: false,
  reconciledAt: null,
  reminderDescription: null,
  reminderEnabled: false,
  reminderName: null,
  repeatCount: null,
  sentiment: "NONE",
  sequenceCount: null,
  siblingTransactionId: null,
  splitId: null,
  subType: null,
  tagIds: [],
  targetFrom: {
    id: "card",
    linkedObjectId: "cardCategory",
    linkedObjectType: "CATEGORY",
    type: "CREDIT_CARD",
  },
  targetTo: { id: "spend", linkedObjectId: null, linkedObjectType: null, type: "CATEGORY" },
  timezone: "UTC",
  type: "OUTFLOW",
  version: 1,
  yearMonth: "2026-10",
};

const fixture = () => {
  const documents = new Map<string, Data>([
    [
      budgetPath,
      {
        availablePeriods: { "2026-10": { id: "periodOne" } },
        stashIdentifiers: {
          ACCOUNTS: "accountsIndex",
          GROUPS_AND_CATEGORIES: "categoriesIndex",
          PAYEES: "payeesIndex",
          TAGS: "tagsIndex",
          TRANSACTIONS: "transactionsIndex",
        },
      },
    ],
    [
      "projects/beyond-budget/databases/(default)/documents/users/testUser",
      { config: { currencyCode: "PHP", timezone: "UTC" }, displayName: "Test" },
    ],
    [
      `${budgetPath}/stashes/accountsIndex`,
      {
        data: {
          card: {
            balanceAmount: -250,
            currencyCode: "",
            id: "card",
            name: "Card",
            pinned: false,
            transactionCount: 1,
            type: "CREDIT_CARD",
            unclearedBalanceAmount: 0,
          },
          cash: {
            balanceAmount: 10_000,
            currencyCode: "",
            id: "cash",
            name: "Cash",
            transactionCount: 0,
            type: "SAVINGS",
            unclearedBalanceAmount: 0,
          },
        },
      },
    ],
    [
      `${budgetPath}/stashes/categoriesIndex`,
      {
        data: {
          categories: {
            cardCategory: {
              id: "cardCategory",
              linkedAccountIds: ["card"],
              transactionCount: 0,
              type: "CREDIT_CARD_PAYMENT",
            },
            spend: {
              color: "BLUE",
              id: "spend",
              linkedAccountIds: [],
              transactionCount: 1,
              type: "DEFAULT",
            },
          },
        },
      },
    ],
    [
      `${budgetPath}/periods/periodOne`,
      {
        allocationAmount: 50_000,
        balances: {
          cardCategory: { otherAmount: 250 },
          spend: { allocatedAmount: 50_000, spentAmount: 250, upcomingAmount: 0 },
        },
      },
    ],
    [
      `${budgetPath}/stashes/payeesIndex`,
      { data: { shop: { id: "shop", name: "Shop", transactionCount: 0 } } },
    ],
    [
      `${budgetPath}/stashes/tagsIndex`,
      { data: { trip: { id: "trip", name: "Trip", transactionCount: 0 } } },
    ],
    [`${budgetPath}/transactions/${transactionId}`, canonicalTransaction],
  ]);

  for (const id of ["transactionsIndex", "periodOne", "card", "cash", "spend", "shop", "trip"]) {
    documents.set(`${budgetPath}/stashes/${id}`, {
      data: {
        completedTransactionCount: 1,
        completedTransactions: { [transactionId]: { cleared: true, integrityCount: 1, notes: "" } },
        historicalBalances: { "2026-10": -250 },
        historicalSpending: { "2026-10": 250 },
        upcomingTransactions: {},
      },
    });
  }

  const calls: { path: string; method: string; body?: string }[] = [];

  const fetcher: Fetcher = (input, init) => {
    const path = new URL(String(input)).pathname.slice(4);
    calls.push({
      body: z.string().safeParse(init?.body).data,
      method: init?.method ?? "GET",
      path,
    });

    if (init?.method !== "GET") {
      return Promise.reject(new Error(`Unexpected write during a dry run: ${path}`));
    }

    const data = documents.get(path);

    if (!data) {
      return Promise.resolve(
        Response.json(
          { error: { message: "No fixture for this document", status: "NOT_FOUND" } },
          { status: 404 }
        )
      );
    }

    return Promise.resolve(
      Response.json({
        createTime: timestamp,
        fields: encodeFields(data),
        name: path,
        updateTime: timestamp,
      })
    );
  };

  const client = new BeyondClient(structuredClone(session), { fetcher });

  return { calls, client, documents, fetcher, service: new TransactionService(client) };
};

const writesFrom = (result: CommitResult): Write[] => {
  if (!("dryRun" in result)) {
    throw new Error("Expected a dry run");
  }

  return result.body.writes;
};

const writeAt = (writes: Write[], suffix: string): Write => {
  const write = writes.find(
    (entry) => (entry.update?.name ?? entry.delete) === `${budgetPath}/${suffix}`
  );

  if (!write) {
    throw new Error(`Missing write: ${suffix}`);
  }

  return write;
};

test("deleting native income cannot leave a linked allocation behind when extras are empty", async () => {
  const { service, documents, calls } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    amount: 250,
    targetFrom: null,
    targetTo: { id: "cash", linkedObjectId: null, linkedObjectType: null, type: "GENERIC_ACCOUNT" },
    type: "INFLOW",
  });
  documents.set(budgetPath, {
    ...documents.get(budgetPath),
    allocationHistory: {
      differentMapKey: { id: transactionId, source: "LINKED_CATEGORY", undoneAt: null },
    },
  });
  await expect(service.delete(transactionId)).rejects.toThrow("allocation");
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("an allocation history map key blocks deletion even when the entry ID is empty", async () => {
  const { service, documents, calls } = fixture();
  documents.set(budgetPath, {
    ...documents.get(budgetPath),
    allocationHistory: { [transactionId]: { id: "", source: "FUTURE_SOURCE", undoneAt: null } },
  });
  await expect(service.delete(transactionId)).rejects.toThrow("allocation");
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("possible automatic allocation blocks financial changes but permits a notes-only edit", async () => {
  const { service, documents, calls } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    autoAllocateIfCapable: true,
    autoAllocateIfIncome: true,
  });
  await expect(service.delete(transactionId)).rejects.toThrow("allocation");
  await expect(service.update(transactionId, { cleared: false })).rejects.toThrow("allocation");

  const writes = writesFrom(
    await service.update(transactionId, { notes: "reviewed" }, { dryRun: true })
  );

  expect(writeAt(writes, `transactions/${transactionId}`).updateMask?.fieldPaths).toEqual([
    "notes",
  ]);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("conflicting account and category links cannot route card reserves to the wrong category", async () => {
  const { service, documents, calls } = fixture();
  documents.set(`${budgetPath}/stashes/accountsIndex`, {
    data: {
      card: {
        id: "card",
        linkedCategoryId: "differentCategory",
        name: "Card",
        type: "CREDIT_CARD",
      },
    },
  });
  await expect(
    service.create({ accountId: "card", amountMinor: 100, categoryId: "spend", dueAt: timestamp })
  ).rejects.toThrow("link");
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("clearing a refund cannot apply ordinary income rules and malformed history cannot bypass protection", async () => {
  const { service, documents, calls } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    extras: { refund: true },
  });
  await expect(
    service.update(transactionId, { cleared: false }, { dryRun: true })
  ).rejects.toThrow();
  documents.set(`${budgetPath}/transactions/${transactionId}`, canonicalTransaction);
  documents.set(budgetPath, { ...documents.get(budgetPath), allocationHistory: null });
  await expect(service.delete(transactionId, { dryRun: true })).rejects.toThrow();
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("card expenses debit the account, fund the payment category, and index the same transaction atomically", async () => {
  const { service, calls } = fixture();

  const writes = writesFrom(
    await service.create(
      {
        accountId: "card",
        amountMinor: 250,
        categoryId: "spend",
        completed: true,
        dueAt: timestamp,
        id: transactionId,
        payeeId: "shop",
        tagIds: ["trip"],
      },
      { dryRun: true }
    )
  );

  expect(writeAt(writes, `transactions/${transactionId}`)).toMatchObject({
    currentDocument: { exists: false },
    update: {
      fields: {
        amount: { integerValue: "-250" },
        autoAllocateIfCapable: { booleanValue: false },
        autoAllocateIfIncome: { booleanValue: false },
        dueAt: { timestampValue: timestamp },
        integrityCount: { integerValue: "1" },
        payee: {
          mapValue: {
            fields: {
              id: { stringValue: "shop" },
              linkedObjectId: { nullValue: null },
              linkedObjectType: { nullValue: null },
              type: { stringValue: "PAYEE" },
            },
          },
        },
      },
    },
  });
  expect(writeAt(writes, "stashes/accountsIndex")).toMatchObject({
    currentDocument: { updateTime: timestamp },
    updateTransforms: expect.arrayContaining([
      { fieldPath: "data.card.balanceAmount", increment: { integerValue: "-250" } },
      { fieldPath: "data.card.transactionCount", increment: { integerValue: "1" } },
    ]),
  });
  expect(writeAt(writes, "periods/periodOne").updateTransforms).toEqual([
    { fieldPath: "balances.cardCategory.otherAmount", increment: { integerValue: "250" } },
    { fieldPath: "balances.spend.spentAmount", increment: { integerValue: "250" } },
  ]);

  for (const index of ["transactionsIndex", "periodOne", "card", "spend", "shop", "trip"]) {
    expect(writeAt(writes, `stashes/${index}`).updateMask?.fieldPaths).toContain(
      `data.completedTransactions.${transactionId}`
    );
  }

  expect(writeAt(writes, "stashes/periodOne").updateTransforms).toBeUndefined();
  expect(writeAt(writes, "stashes/shop").updateTransforms).toEqual(
    expect.arrayContaining([
      { fieldPath: "data.historicalBalances.`2026-10`", increment: { integerValue: "-250" } },
      { fieldPath: "data.historicalSpending.`2026-10`", increment: { integerValue: "250" } },
    ])
  );
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("income without a zero-based budget type credits cash without changing allocation resources or category spending", async () => {
  const { service } = fixture();

  const writes = writesFrom(
    await service.create(
      { accountId: "cash", amountMinor: 125, completed: true, dueAt: timestamp, type: "INFLOW" },
      { dryRun: true }
    )
  );

  expect(writeAt(writes, "stashes/accountsIndex").updateTransforms).toEqual(
    expect.arrayContaining([
      { fieldPath: "data.cash.balanceAmount", increment: { integerValue: "125" } },
    ])
  );
  expect(writes.some((write) => write.update?.name === `${budgetPath}/periods/periodOne`)).toBe(
    false
  );
});

test("cleared zero-based income increases allocation resources without funding a category", async () => {
  const { service, documents } = fixture();
  documents.set(budgetPath, { ...documents.get(budgetPath), type: "ZERO_BASED" });

  const result = await service.create(
    {
      accountId: "cash",
      amountMinor: 125,
      cleared: true,
      completed: true,
      dueAt: timestamp,
      type: "INFLOW",
    },
    { dryRun: true }
  );

  const writes = writesFrom(result);
  expect(writeAt(writes, "periods/periodOne").updateTransforms).toEqual([
    { fieldPath: "allocationAmount", increment: { integerValue: "125" } },
  ]);
  expect(result.automaticAllocation).toBe(false);
  expect(result.summary?.allocationResources).toEqual({
    after: 50_125,
    before: 50_000,
    delta: 125,
  });

  const uncleared = writesFrom(
    await service.create(
      {
        accountId: "cash",
        amountMinor: 125,
        cleared: false,
        completed: true,
        dueAt: timestamp,
        type: "INFLOW",
      },
      { dryRun: true }
    )
  );

  expect(uncleared.some((write) => write.update?.name === `${budgetPath}/periods/periodOne`)).toBe(
    false
  );
});

test("deletion and clearing changes adjust only independent income's zero-based allocation resources", async () => {
  const { service, documents } = fixture();
  documents.set(budgetPath, { ...documents.get(budgetPath), type: "ZERO_BASED" });
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    amount: 250,
    targetFrom: null,
    targetTo: { id: "cash", linkedObjectId: null, linkedObjectType: null, type: "GENERIC_ACCOUNT" },
    type: "INFLOW",
  });
  const deleted = writesFrom(await service.delete(transactionId, { dryRun: true }));
  expect(writeAt(deleted, "periods/periodOne").updateTransforms).toEqual([
    { fieldPath: "allocationAmount", increment: { integerValue: "-250" } },
  ]);

  const uncleared = writesFrom(
    await service.update(transactionId, { cleared: false }, { dryRun: true })
  );

  expect(writeAt(uncleared, "periods/periodOne").updateTransforms).toEqual([
    { fieldPath: "allocationAmount", increment: { integerValue: "-250" } },
  ]);

  const income = documents.get(`${budgetPath}/transactions/${transactionId}`);
  documents.set(`${budgetPath}/transactions/${transactionId}`, { ...income, cleared: false });

  const cleared = writesFrom(
    await service.update(transactionId, { cleared: true }, { dryRun: true })
  );

  expect(writeAt(cleared, "periods/periodOne").updateTransforms).toEqual([
    { fieldPath: "allocationAmount", increment: { integerValue: "250" } },
  ]);

  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...income,
    cleared: false,
    completed: false,
  });

  const upcoming = writesFrom(
    await service.update(transactionId, { cleared: true }, { dryRun: true })
  );

  expect(upcoming.some((write) => write.update?.name === `${budgetPath}/periods/periodOne`)).toBe(
    false
  );
});

test("income remains writable in a period with no category balances yet", async () => {
  const { service, documents } = fixture();
  documents.set(`${budgetPath}/periods/periodOne`, { allocationAmount: 0 });

  const writes = writesFrom(
    await service.create(
      { accountId: "cash", amountMinor: 125, completed: true, dueAt: timestamp, type: "INFLOW" },
      { dryRun: true }
    )
  );

  expect(writeAt(writes, "stashes/accountsIndex").updateTransforms).toEqual(
    expect.arrayContaining([
      { fieldPath: "data.cash.balanceAmount", increment: { integerValue: "125" } },
    ])
  );
});

test("upcoming expenses record obligations without debiting account balances", async () => {
  const { service } = fixture();

  const writes = writesFrom(
    await service.create(
      {
        accountId: "card",
        amountMinor: 100,
        categoryId: "spend",
        completed: false,
        dueAt: timestamp,
      },
      { dryRun: true }
    )
  );

  expect(writeAt(writes, "periods/periodOne").updateTransforms).toEqual([
    { fieldPath: "balances.spend.upcomingAmount", increment: { integerValue: "100" } },
  ]);
  expect(writeAt(writes, "stashes/accountsIndex").updateTransforms).toEqual([
    { fieldPath: "data.card.transactionCount", increment: { integerValue: "1" } },
  ]);
});

test("metadata edits mirror notes and uncleared balance without incrementing integrityCount", async () => {
  const { service } = fixture();

  const writes = writesFrom(
    await service.update(transactionId, { cleared: false, notes: "corrected" }, { dryRun: true })
  );

  const transactionWrite = writeAt(writes, `transactions/${transactionId}`);
  expect(transactionWrite).toMatchObject({
    currentDocument: { updateTime: timestamp },
  });
  expect(transactionWrite.updateMask?.fieldPaths.toSorted()).toEqual(["cleared", "notes"]);
  expect(writeAt(writes, "stashes/accountsIndex").updateTransforms).toEqual([
    { fieldPath: "data.card.unclearedBalanceAmount", increment: { integerValue: "-250" } },
  ]);

  for (const index of ["transactionsIndex", "periodOne", "card", "spend"]) {
    expect(writeAt(writes, `stashes/${index}`).updateMask?.fieldPaths.toSorted()).toEqual([
      `data.completedTransactions.${transactionId}.cleared`,
      `data.completedTransactions.${transactionId}.notes`,
    ]);
  }
});

test("deleting a card expense reverses payment funding and skips previews absent from trimmed indexes", async () => {
  const { service, documents } = fixture();
  documents.set(`${budgetPath}/stashes/transactionsIndex`, {
    data: { completedTransactionCount: 447, completedTransactions: {} },
  });
  const writes = writesFrom(await service.delete(transactionId, { dryRun: true }));
  expect(writeAt(writes, `transactions/${transactionId}`)).toEqual({
    currentDocument: { updateTime: timestamp },
    delete: `${budgetPath}/transactions/${transactionId}`,
  });
  expect(writeAt(writes, "periods/periodOne").updateTransforms).toEqual([
    { fieldPath: "balances.cardCategory.otherAmount", increment: { integerValue: "-250" } },
    { fieldPath: "balances.spend.spentAmount", increment: { integerValue: "-250" } },
  ]);
  expect(writeAt(writes, "stashes/accountsIndex").updateTransforms).toEqual(
    expect.arrayContaining([
      { fieldPath: "data.card.balanceAmount", increment: { integerValue: "250" } },
      { fieldPath: "data.card.transactionCount", increment: { integerValue: "-1" } },
    ])
  );
  expect(
    writes.some((write) => write.update?.name === `${budgetPath}/stashes/transactionsIndex`)
  ).toBe(false);
  expect(writeAt(writes, "stashes/card").updateMask?.fieldPaths).toContain(
    `data.completedTransactions.${transactionId}`
  );
  expect(writeAt(writes, "stashes/card").update?.fields).toEqual({
    data: { mapValue: { fields: { completedTransactions: { mapValue: { fields: {} } } } } },
  });
});

test("unfunded card expenses and duplicate tags are refused before committing", async () => {
  const { service, calls } = fixture();
  await expect(
    service.create({
      accountId: "card",
      amountMinor: 50_001,
      categoryId: "spend",
      completed: true,
      dueAt: timestamp,
    })
  ).rejects.toThrow("Fund the expense category");
  await expect(
    service.create({
      accountId: "card",
      amountMinor: 100,
      categoryId: "spend",
      dueAt: timestamp,
      tagIds: ["trip", "trip"],
    })
  ).rejects.toThrow("unique IDs");
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("account settings update only requested fields with a snapshot precondition", async () => {
  const { client, calls } = fixture();
  await client.discover();

  const writes = writesFrom(
    await new AccountService(client).update("card", { pinned: true }, { dryRun: true })
  );

  expect(writeAt(writes, "stashes/accountsIndex")).toEqual({
    currentDocument: { updateTime: timestamp },
    update: {
      fields: {
        data: {
          mapValue: {
            fields: { card: { mapValue: { fields: { pinned: { booleanValue: true } } } } },
          },
        },
      },
      name: `${budgetPath}/stashes/accountsIndex`,
    },
    updateMask: { fieldPaths: ["data.card.pinned"] },
  });
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("canonical history includes upcoming records whose budget period has not been assigned", async () => {
  const urls: string[] = [];

  const omittedFields = new Set([
    "periodId",
    "reconciledAt",
    "clonedToTransactionId",
    "autoAllocateIfIncome",
  ]);

  const unassigned: Data = Object.fromEntries(
    Object.entries({
      ...canonicalTransaction,
      completed: false,
      id: "unassigned",
    }).filter(([key]) => !omittedFields.has(key))
  );

  const client = new BeyondClient(session, {
    fetcher: (input) => {
      urls.push(String(input));

      return Promise.resolve(
        Response.json({
          documents: [
            {
              fields: encodeFields({
                ...canonicalTransaction,
                completed: false,
                id: "upcoming",
                periodId: null,
              }),
              name: `${budgetPath}/transactions/upcoming`,
            },
            { fields: encodeFields(unassigned), name: `${budgetPath}/transactions/unassigned` },
          ],
          nextPageToken: "next-page",
        })
      );
    },
  });

  const result = await new TransactionService(client).list({
    limit: 10,
    pageToken: "previous-page",
  });

  expect(
    result.transactions.map((transaction) => ({
      id: transaction.id,
      periodId: transaction.periodId,
    }))
  ).toEqual([
    { id: "upcoming", periodId: null },
    { id: "unassigned", periodId: undefined },
  ]);
  expect(result).toMatchObject({ nextPageToken: "next-page", source: "canonical-collection" });
  expect(urls).toEqual([
    `https://firestore.googleapis.com/v1/${budgetPath}/transactions?pageSize=10&orderBy=dueAt+desc&pageToken=previous-page`,
  ]);
});

test("account history queries both target directions without an unavailable compound sort index", async () => {
  let query: unknown;

  const client = new BeyondClient(session, {
    fetcher: (input, init) => {
      expect(String(input)).toBe(`https://firestore.googleapis.com/v1/${budgetPath}:runQuery`);
      expect(init?.method).toBe("POST");
      query = JSON.parse(String(init?.body));

      return Promise.resolve(
        Response.json([
          {
            document: {
              fields: encodeFields({
                ...canonicalTransaction,
                dueAt: "2026-09-01T00:00:00.000Z",
                id: "older",
              }),
            },
          },
          { readTime: timestamp },
          {
            document: {
              fields: encodeFields({
                ...canonicalTransaction,
                dueAt: "2026-10-01T00:00:00.000Z",
                id: "newer",
              }),
            },
          },
        ])
      );
    },
  });

  const result = await new TransactionService(client).list({ accountId: "card", limit: 1 });
  expect(result.transactions.map((transaction) => transaction.id)).toEqual(["newer"]);
  expect(result).toMatchObject({ matched: 2, scanLimitReached: false, source: "canonical-query" });
  expect(query).toEqual({
    structuredQuery: {
      from: [{ collectionId: "transactions" }],
      limit: 10_000,
      where: {
        compositeFilter: {
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: "targetFrom.id" },
                op: "EQUAL",
                value: { stringValue: "card" },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: "targetTo.id" },
                op: "EQUAL",
                value: { stringValue: "card" },
              },
            },
          ],
          op: "OR",
        },
      },
    },
  });
});

test("monthly funding includes other funds and carryover but keeps upcoming obligations separate", async () => {
  const { client, documents, calls } = fixture();
  documents.set(`${budgetPath}/periods/periodOne`, {
    balances: {
      cardCategory: { otherAmount: 250 },
      orphan: { allocatedAmount: 20 },
      spend: {
        allocatedAmount: 1000,
        carriedOverAmount: -100,
        otherAmount: 75,
        spentAmount: 400,
        upcomingAmount: 900,
      },
    },
  });
  const result = await categoryFunding(client, "2026-10");
  expect(result).toMatchObject({ periodId: "periodOne", yearMonth: "2026-10" });
  expect(result.categories).toEqual([
    {
      allocatedAmount: 0,
      availableAmount: 250,
      carriedOverAmount: 0,
      id: "cardCategory",
      otherAmount: 250,
      spentAmount: 0,
      type: "CREDIT_CARD_PAYMENT",
      upcomingAmount: 0,
    },
    {
      allocatedAmount: 1000,
      availableAmount: 575,
      carriedOverAmount: -100,
      id: "spend",
      otherAmount: 75,
      spentAmount: 400,
      type: "DEFAULT",
      upcomingAmount: 900,
    },
    {
      allocatedAmount: 20,
      availableAmount: 20,
      carriedOverAmount: 0,
      id: "orphan",
      otherAmount: 0,
      spentAmount: 0,
      upcomingAmount: 0,
    },
  ]);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("funding queries reject missing months and categories instead of inventing balances", async () => {
  const { client, calls } = fixture();
  await expect(categoryFunding(client, "2026-13")).rejects.toThrow("YYYY-MM");
  expect(calls).toHaveLength(0);
  await expect(categoryFunding(client, "2026-09")).rejects.toThrow("does not exist");
  await expect(categoryFunding(client, "2026-10", "missing")).rejects.toThrow("Category not found");
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("funding queries reject unsafe money and retain zero funds for categories without a balance", async () => {
  const { client, documents } = fixture();
  documents.set(`${budgetPath}/periods/periodOne`, {});
  const empty = await categoryFunding(client, "2026-10", "spend");
  expect(empty.categories).toEqual([
    {
      allocatedAmount: 0,
      availableAmount: 0,
      carriedOverAmount: 0,
      id: "spend",
      otherAmount: 0,
      spentAmount: 0,
      type: "DEFAULT",
      upcomingAmount: 0,
    },
  ]);
  documents.set(`${budgetPath}/periods/periodOne`, {
    balances: { spend: { allocatedAmount: Number.MAX_SAFE_INTEGER, otherAmount: 1 } },
  });
  await expect(categoryFunding(client, "2026-10")).rejects.toThrow("safe integer");
  documents.set(`${budgetPath}/periods/periodOne`, {
    balances: { spend: { allocatedAmount: 1.5 } },
  });
  await expect(categoryFunding(client, "2026-10")).rejects.toThrow();
});

test("diagnostics preserve conflicting raw links and unknown settings at their observed paths", async () => {
  const { client, documents, calls } = fixture();
  documents.set(`${budgetPath}/stashes/accountsIndex`, {
    data: { card: { id: "card", linkedCategoryId: "differentCategory", type: "CREDIT_CARD" } },
  });
  documents.set(`${budgetPath}/stashes/categoriesIndex`, {
    data: {
      categories: {
        cardCategory: {
          id: "cardCategory",
          linkedAccountIds: ["card", "missing"],
          type: "FUTURE_TYPE",
        },
        strange: { id: "strange", linkedAccountIds: { future: true }, type: 81 },
      },
    },
  });
  documents.set("projects/beyond-budget/databases/(default)/documents/users/testUser", {
    config: { autoAllocateIncomeEnabled: true, unknownPreference: { mode: 91 } },
  });
  const result = await budgetDiagnostics(client);
  expect(result.links).toEqual([
    {
      document: `${budgetPath}/stashes/accountsIndex`,
      path: ["data", "card", "linkedCategoryId"],
      value: "differentCategory",
    },
    {
      document: `${budgetPath}/stashes/categoriesIndex`,
      path: ["data", "categories", "cardCategory", "linkedAccountIds"],
      value: ["card", "missing"],
    },
    {
      document: `${budgetPath}/stashes/categoriesIndex`,
      path: ["data", "categories", "strange", "linkedAccountIds"],
      value: { future: true },
    },
  ]);
  expect(result.settings).toContainEqual({
    document: "projects/beyond-budget/databases/(default)/documents/users/testUser",
    path: ["config"],
    value: { autoAllocateIncomeEnabled: true, unknownPreference: { mode: 91 } },
  });
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("card dry runs distinguish account debt, spending funds, and payment reserves", async () => {
  const { service } = fixture();

  const result = await service.create(
    { accountId: "card", amountMinor: 250, categoryId: "spend", completed: true, dueAt: timestamp },
    { dryRun: true }
  );

  expect(result.summary).toMatchObject({
    accounts: [
      {
        balanceAmount: { after: -500, before: -250, delta: -250 },
        id: "card",
        unclearedBalanceAmount: { after: 0, before: 0, delta: 0 },
      },
    ],
    automaticAllocation: false,
    categories: [
      {
        after: { availableAmount: 49_500, spentAmount: 500 },
        before: { availableAmount: 49_750, spentAmount: 250 },
        id: "spend",
        role: "expense",
        yearMonth: "2026-10",
      },
      {
        after: { availableAmount: 500, otherAmount: 500 },
        before: { availableAmount: 250, otherAmount: 250 },
        id: "cardCategory",
        role: "cardPaymentReserve",
      },
    ],
    operation: "create",
    transaction: { after: { amount: -250, cleared: true, completed: true }, before: null },
  });
});

test("income and upcoming previews show only their actual money effects", async () => {
  const { service } = fixture();

  const income = await service.create(
    {
      accountId: "cash",
      amountMinor: 125,
      cleared: false,
      completed: true,
      dueAt: timestamp,
      type: "INFLOW",
    },
    { dryRun: true }
  );

  expect(income.summary).toMatchObject({
    accounts: [
      {
        balanceAmount: { after: 10_125, before: 10_000, delta: 125 },
        id: "cash",
        unclearedBalanceAmount: { after: 125, before: 0, delta: 125 },
      },
    ],
    automaticAllocation: false,
    categories: [],
  });

  const upcoming = await service.create(
    {
      accountId: "card",
      amountMinor: 100,
      categoryId: "spend",
      completed: false,
      dueAt: timestamp,
    },
    { dryRun: true }
  );

  expect(upcoming.summary).toMatchObject({
    accounts: [],
    categories: [
      {
        after: { availableAmount: 49_750, upcomingAmount: 100 },
        before: { availableAmount: 49_750, upcomingAmount: 0 },
        id: "spend",
      },
    ],
  });
});

test("delete and cleared previews show reversal and uncleared changes without allocating", async () => {
  const { service } = fixture();
  const deleted = await service.delete(transactionId, { dryRun: true });
  expect(deleted.summary).toMatchObject({
    accounts: [{ balanceAmount: { after: 0, before: -250, delta: 250 }, id: "card" }],
    automaticAllocation: false,
    categories: [
      { after: { availableAmount: 50_000 }, before: { availableAmount: 49_750 }, id: "spend" },
      {
        after: { otherAmount: 0 },
        before: { otherAmount: 250 },
        id: "cardCategory",
        role: "cardPaymentReserve",
      },
    ],
    operation: "delete",
    transaction: { after: null, before: { id: transactionId } },
  });

  const edited = await service.update(
    transactionId,
    { cleared: false, notes: "corrected" },
    { dryRun: true }
  );

  expect(edited.summary).toMatchObject({
    accounts: [
      {
        balanceAmount: { after: -250, before: -250, delta: 0 },
        id: "card",
        unclearedBalanceAmount: { after: -250, before: 0, delta: -250 },
      },
    ],
    automaticAllocation: false,
    categories: [],
    operation: "update",
    transaction: {
      after: { cleared: false, notes: "corrected" },
      before: { cleared: true, notes: "" },
    },
  });
});

test("CLI funding, diagnostics, and compact dry runs expose semantic results without writes", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-funding-cli-"));
  const previous = process.env.BEBU_SESSION_FILE;
  const { fetcher, calls } = fixture();

  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fetcher, { preconnect: fetch.preconnect })
  );

  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    await writeFile(process.env.BEBU_SESSION_FILE, JSON.stringify(session));

    const funding = await captureExecute(createApp(), [
      "categories",
      "funding",
      "--month",
      "2026-10",
      "--category",
      "spend",
    ]);

    expect(funding.exitCode).toBe(0);
    expect(JSON.parse(funding.stdout)).toMatchObject({
      categories: [{ availableAmount: 49_750, id: "spend", otherAmount: 0 }],
    });
    const diagnostics = await captureExecute(createApp(), ["budget", "diagnostics"]);
    expect(diagnostics.exitCode).toBe(0);
    expect(JSON.parse(diagnostics.stdout)).toMatchObject({
      links: [
        { path: ["data", "categories", "cardCategory", "linkedAccountIds"], value: ["card"] },
        { path: ["data", "categories", "spend", "linkedAccountIds"], value: [] },
      ],
    });

    const payload = nodePath.join(directory, "transaction.json");
    await writeFile(
      payload,
      JSON.stringify({
        accountId: "cash",
        amountMinor: 125,
        completed: true,
        dueAt: timestamp,
        type: "INFLOW",
      })
    );

    const preview = await captureExecute(createApp(), [
      "transactions",
      "create",
      "--dry-run",
      "--file",
      payload,
    ]);

    expect(preview.exitCode).toBe(0);
    const result = JSON.parse(preview.stdout);
    expect(result).toMatchObject({
      automaticAllocation: false,
      dryRun: true,
      summary: {
        accounts: [{ balanceAmount: { after: 10_125, before: 10_000, delta: 125 }, id: "cash" }],
      },
    });
    expect(result.body).toBeUndefined();

    const full = await captureExecute(createApp(), [
      "transactions",
      "create",
      "--dry-run",
      "--full",
      "--file",
      payload,
    ]);

    expect(full.exitCode).toBe(0);
    expect(JSON.parse(full.stdout)).toMatchObject({
      body: { writes: expect.any(Array) },
      summary: { categories: [] },
    });
    expect(calls.every((call) => call.method === "GET")).toBe(true);
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

test("funding preserves exact available money when large intermediate sums exceed safe integers", async () => {
  const { client, documents } = fixture();
  documents.set(`${budgetPath}/periods/periodOne`, {
    balances: {
      spend: {
        allocatedAmount: 9_007_199_254_740_991,
        carriedOverAmount: 2,
        otherAmount: -2,
      },
    },
  });
  const result = await categoryFunding(client, "2026-10", "spend");
  expect(result.categories[0]?.availableAmount).toBe(9_007_199_254_740_991);
});
