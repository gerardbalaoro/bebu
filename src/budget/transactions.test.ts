import { expect, test } from "bun:test";

import { z } from "zod";

import type { Session } from "../auth/session.ts";
import { BeyondClient } from "../firestore/client.ts";
import type { Fetcher } from "../firestore/client.ts";
import { encodeFields } from "../firestore/encoding.ts";
import type { CommitResult, Data, Write } from "../firestore/encoding.ts";
import { AccountService } from "./accounts.ts";
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

  return { calls, client, documents, service: new TransactionService(client) };
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

test("income credits cash without changing allocationAmount or category spending", async () => {
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
