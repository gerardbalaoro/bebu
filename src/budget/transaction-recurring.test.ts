import { expect, test } from "bun:test";
import assert from "node:assert/strict";

import type { Session } from "../auth/session.ts";
import { BeyondClient } from "../firestore/client.ts";
import type { Fetcher } from "../firestore/client.ts";
import { decode, encodeFields } from "../firestore/encoding.ts";
import type { Data } from "../firestore/encoding.ts";
import { requireIndependentTransaction } from "./allocation-effects.ts";
import { TransactionSchema } from "./transaction-model.ts";
import { TransactionService } from "./transactions.ts";

const BudgetPath = "projects/beyond-budget/databases/(default)/documents/budgets/recurringBudget";
const TransactionId = "RecurringPayment1234";
const Timestamp = "2026-10-01T12:00:00.000Z";

const recurringTransaction = () =>
  TransactionSchema.parse({
    amount: -250,
    autoAllocateIfCapable: true,
    autoAllocateIfIncome: true,
    budgetId: "recurringBudget",
    cleared: true,
    clonedToTransactionId: null,
    color: "NONE",
    completed: false,
    createdAt: Timestamp,
    createdBy: { displayName: "Test", email: null, photoUrl: "", uid: "testUser" },
    dueAt: "2030-10-01T12:00:00.000Z",
    editable: true,
    eventId: null,
    externalId: null,
    extraTarget: null,
    extras: {},
    files: [],
    frequency: "MONTHLY",
    id: TransactionId,
    integrityCount: 1,
    latitude: null,
    longitude: null,
    nonWorkingDayPolicy: "KEEP_ORIGINAL_DATE",
    notes: "",
    occurrenceChange: { amount: -250, dueAt: null, seriesAmount: -200, seriesAnchorAt: null },
    offsetAdjustment: 0,
    payee: null,
    periodId: "periodOne",
    reconciled: false,
    reminderDescription: null,
    reminderEnabled: false,
    reminderName: null,
    repeatCount: null,
    sentiment: "NONE",
    sequenceCount: 4,
    siblingTransactionId: null,
    splitId: null,
    subType: null,
    tagIds: [],
    targetFrom: {
      id: "cash",
      linkedObjectId: null,
      linkedObjectType: null,
      type: "GENERIC_ACCOUNT",
    },
    targetTo: { id: "spend", linkedObjectId: null, linkedObjectType: null, type: "CATEGORY" },
    timezone: "UTC",
    type: "OUTFLOW",
    version: null,
    yearMonth: "2030-10",
  });

const fixture = () => {
  const transaction = recurringTransaction();

  const documents = new Map<string, Data>([
    [
      BudgetPath,
      {
        availablePeriods: { "2030-10": { id: "periodOne" } },
        stashIdentifiers: {
          ACCOUNTS: "accountsIndex",
          GROUPS_AND_CATEGORIES: "categoriesIndex",
          TRANSACTIONS: "transactionsIndex",
        },
      },
    ],
    [
      "projects/beyond-budget/databases/(default)/documents/users/testUser",
      { config: { currencyCode: "PHP", timezone: "UTC" } },
    ],
    [
      `${BudgetPath}/stashes/accountsIndex`,
      {
        data: {
          cash: {
            balanceAmount: 10_000,
            id: "cash",
            name: "Cash",
            transactionCount: 4,
            type: "SAVINGS",
          },
        },
      },
    ],
    [
      `${BudgetPath}/stashes/categoriesIndex`,
      {
        data: {
          categories: {
            spend: { id: "spend", linkedAccountIds: [], transactionCount: 4, type: "DEFAULT" },
          },
        },
      },
    ],
    [
      `${BudgetPath}/periods/periodOne`,
      { balances: { spend: { allocatedAmount: 1000, upcomingAmount: 250 } } },
    ],
    [`${BudgetPath}/transactions/${TransactionId}`, transaction],
  ]);

  for (const id of ["transactionsIndex", "periodOne", "cash", "spend"]) {
    documents.set(`${BudgetPath}/stashes/${id}`, {
      data: { upcomingTransactions: { [TransactionId]: { amount: -250, seriesAmount: -200 } } },
    });
  }

  const requests: string[] = [];

  const fetcher: Fetcher = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request.method);

    if (request.method !== "GET") {
      throw new Error("The recurring edit dry run attempted a write");
    }

    const path = new URL(request.url).pathname.slice(4);
    const data = documents.get(path);

    if (data === undefined) {
      return await Promise.resolve(
        Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 })
      );
    }

    return await Promise.resolve(
      Response.json({
        createTime: Timestamp,
        fields: encodeFields(data),
        name: path,
        updateTime: Timestamp,
      })
    );
  };

  const session: Session = {
    budgetIds: ["recurringBudget"],
    expiresAt: Date.now() + 3_600_000,
    idToken: "token",
    importedAt: Timestamp,
    projectId: "beyond-budget",
    stashes: [],
    uid: "testUser",
    version: 1,
  };

  const service = new TransactionService(new BeyondClient(session, { fetcher }));

  return { documents, requests, service, transaction };
};

test("upcoming recurring amount edits retain flags and replace the future series baseline in every preview", async () => {
  const { service, requests, transaction } = fixture();
  const result = await service.update(TransactionId, { amountMinor: 400 }, { dryRun: true });
  assert.ok("dryRun" in result);
  const { writes } = result.body;

  const canonical = writes.find(
    (write) => write.update?.name === `${BudgetPath}/transactions/${TransactionId}`
  );

  assert.ok(canonical?.update?.fields);
  expect(decode(canonical.update.fields.amount)).toBe(-400);
  expect(decode(canonical.update.fields.occurrenceChange)).toBeNull();
  expect(canonical.updateMask?.fieldPaths).not.toContain("autoAllocateIfCapable");
  expect(canonical.updateMask?.fieldPaths).not.toContain("autoAllocateIfIncome");

  for (const id of ["transactionsIndex", "periodOne", "cash", "spend"]) {
    const preview = writes.find((write) => write.update?.name === `${BudgetPath}/stashes/${id}`);
    expect(decode(preview?.update?.fields?.data)).toMatchObject({
      upcomingTransactions: { [TransactionId]: { amount: -400, seriesAmount: null } },
    });
  }

  expect(
    writes.find((write) => write.update?.name === `${BudgetPath}/periods/periodOne`)
      ?.updateTransforms
  ).toEqual([{ fieldPath: "balances.spend.upcomingAmount", increment: { integerValue: "150" } }]);
  expect(writes.some((write) => write.update?.name === `${BudgetPath}/stashes/accountsIndex`)).toBe(
    false
  );
  expect(transaction.autoAllocateIfCapable).toBe(true);
  expect(requests.every((method) => method === "GET")).toBe(true);
});

test("a generated recurring occurrence can change amount without rewriting its clone relationship", async () => {
  const { service, documents, transaction } = fixture();
  documents.set(`${BudgetPath}/transactions/${TransactionId}`, {
    ...transaction,
    clonedToTransactionId: "NextRecurringPayment",
  });

  const result = await service.update(
    TransactionId,
    { amountMinor: 350, recurrenceScope: "THIS_PAYMENT" },
    { dryRun: true }
  );

  assert.ok("dryRun" in result);

  const canonical = result.body.writes.find(
    (write) => write.update?.name === `${BudgetPath}/transactions/${TransactionId}`
  );

  expect(canonical?.updateMask?.fieldPaths).not.toContain("clonedToTransactionId");
  expect(decode(canonical?.update?.fields?.occurrenceChange)).toEqual({
    amount: -350,
    dueAt: null,
    seriesAmount: -200,
    seriesAnchorAt: null,
  });
  expect(
    result.body.writes.some(
      (write) => write.update?.name.endsWith("/NextRecurringPayment") === true
    )
  ).toBe(false);
});

test("the current occurrence amount can become the future baseline without changing its ledger amount", async () => {
  const { service } = fixture();

  const result = await service.update(
    TransactionId,
    { amountMinor: 250, recurrenceScope: "THIS_AND_LATER" },
    { dryRun: true }
  );

  assert.ok("dryRun" in result);

  const canonical = result.body.writes.find(
    (write) => write.update?.name === `${BudgetPath}/transactions/${TransactionId}`
  );

  assert.ok(canonical?.update?.fields);
  expect(decode(canonical.update.fields.occurrenceChange)).toBeNull();
  expect(canonical.updateMask?.fieldPaths).toEqual(["occurrenceChange"]);

  const preview = result.body.writes.find(
    (write) => write.update?.name === `${BudgetPath}/stashes/transactionsIndex`
  );

  expect(decode(preview?.update?.fields?.data)).toEqual({
    upcomingTransactions: { [TransactionId]: { seriesAmount: null } },
  });
  expect(
    result.body.writes.some((write) => write.update?.name.includes("/periods/") === true)
  ).toBe(false);
});

test("the current occurrence date can become the future date baseline without moving its obligation", async () => {
  const { service, transaction, documents } = fixture();
  documents.set(`${BudgetPath}/transactions/${TransactionId}`, {
    ...transaction,
    anchorDay: 1,
    occurrenceChange: {
      amount: null,
      dueAt: transaction.dueAt,
      seriesAmount: null,
      seriesAnchorAt: "2030-09-15T12:00:00.000Z",
    },
  });

  const result = await service.update(
    TransactionId,
    { dueAt: transaction.dueAt, recurrenceScope: "THIS_AND_LATER" },
    { dryRun: true }
  );

  assert.ok("dryRun" in result);

  const canonical = result.body.writes.find(
    (write) => write.update?.name === `${BudgetPath}/transactions/${TransactionId}`
  );

  assert.ok(canonical?.update?.fields);
  expect(decode(canonical.update.fields.occurrenceChange)).toBeNull();
  expect(canonical.updateMask?.fieldPaths).toEqual(["occurrenceChange"]);

  const preview = result.body.writes.find(
    (write) => write.update?.name === `${BudgetPath}/stashes/transactionsIndex`
  );

  expect(decode(preview?.update?.fields?.data)).toEqual({
    upcomingTransactions: { [TransactionId]: { seriesAnchorAt: null } },
  });
  expect(
    result.body.writes.some((write) => write.update?.name.includes("/periods/") === true)
  ).toBe(false);
});

test("a completed generated recurring expense edits its ledger while retaining allocation flags and the next occurrence", async () => {
  const { service, documents, transaction, requests } = fixture();
  documents.set(`${BudgetPath}/transactions/${TransactionId}`, {
    ...transaction,
    clonedToTransactionId: "NextRecurringPayment",
    completed: true,
    dueAt: Timestamp,
    version: 1,
    yearMonth: "2026-10",
  });
  const result = await service.update(TransactionId, { amountMinor: 350 }, { dryRun: true });
  assert.ok("dryRun" in result);
  const { writes } = result.body;

  const account = writes.find(
    (write) => write.update?.name === `${BudgetPath}/stashes/accountsIndex`
  );

  expect(account?.updateTransforms).toContainEqual({
    fieldPath: "data.cash.balanceAmount",
    increment: { integerValue: "-100" },
  });
  const period = writes.find((write) => write.update?.name === `${BudgetPath}/periods/periodOne`);
  expect(period?.updateTransforms).toContainEqual({
    fieldPath: "balances.spend.spentAmount",
    increment: { integerValue: "100" },
  });
  const history = writes.find((write) => write.update?.name === `${BudgetPath}/stashes/cash`);
  expect(history?.updateTransforms).toContainEqual({
    fieldPath: "data.historicalBalances.`2026-10`",
    increment: { integerValue: "-100" },
  });

  const canonical = writes.find(
    (write) => write.update?.name === `${BudgetPath}/transactions/${TransactionId}`
  );

  expect(canonical?.updateMask?.fieldPaths).toEqual(["amount"]);
  expect(
    writes.some((write) => write.update?.name.endsWith("/NextRecurringPayment") === true)
  ).toBe(false);
  expect(requests.every((method) => method === "GET")).toBe(true);
});

test("an edit cannot enable a linked allocation when the old recurring income was uncleared", async () => {
  const { service, documents, transaction, requests } = fixture();
  documents.set(`${BudgetPath}/transactions/${TransactionId}`, {
    ...transaction,
    amount: 250,
    cleared: false,
    completed: true,
    dueAt: Timestamp,
    targetFrom: null,
    targetTo: {
      id: "cash",
      linkedObjectId: "savings",
      linkedObjectType: "CATEGORY",
      type: "GENERIC_ACCOUNT",
    },
    type: "INFLOW",
    version: 1,
    yearMonth: "2026-10",
  });
  await assert.rejects(
    service.update(TransactionId, { cleared: true }, { dryRun: true }),
    /allocation/u
  );
  expect(requests.every((method) => method === "GET")).toBe(true);
});

test("allocation flags alone do not block a completed unlinked recurring expense", () => {
  const transaction = { ...recurringTransaction(), completed: true, version: 1 };
  expect(() => {
    requireIndependentTransaction(transaction, {});
  }).not.toThrow();
});

test("incomplete linked recurring entries have no completed allocation effect to reverse", () => {
  const transaction = recurringTransaction();
  transaction.targetFrom = {
    id: "cash",
    linkedObjectId: "savings",
    linkedObjectType: "CATEGORY",
    type: "GENERIC_ACCOUNT",
  };
  expect(() => {
    requireIndependentTransaction(transaction, {});
  }).not.toThrow();
});

test("actual linked allocation eligibility and recorded history still block financial edits", () => {
  const transaction = { ...recurringTransaction(), completed: true, version: 1 };
  transaction.targetFrom = {
    id: "cash",
    linkedObjectId: "savings",
    linkedObjectType: "CATEGORY",
    type: "GENERIC_ACCOUNT",
  };
  expect(() => {
    requireIndependentTransaction(transaction, {});
  }).toThrow(/allocation/u);
  const independent = recurringTransaction();
  expect(() => {
    requireIndependentTransaction(independent, {
      allocationHistory: { anotherKey: { id: TransactionId } },
    });
  }).toThrow(/allocation/u);
  expect(() => {
    requireIndependentTransaction({ ...independent, extras: { autoAllocated: true } }, {});
  }).toThrow(/allocation/u);
});

test("ineligible linked states and unused income flags do not establish allocation effects", () => {
  const transaction = { ...recurringTransaction(), completed: true, version: 1 };
  transaction.targetFrom = {
    id: "cash",
    linkedObjectId: "savings",
    linkedObjectType: "CATEGORY",
    type: "GENERIC_ACCOUNT",
  };

  for (const changed of [
    { ...transaction, cleared: false },
    { ...transaction, version: null },
    { ...transaction, autoAllocateIfCapable: false },
  ]) {
    expect(() => {
      requireIndependentTransaction(changed, {});
    }).not.toThrow();
  }

  const income = {
    ...recurringTransaction(),
    amount: 250,
    completed: true,
    targetFrom: null,
    targetTo: { id: "cash", linkedObjectId: null, linkedObjectType: null, type: "GENERIC_ACCOUNT" },
    type: "INFLOW",
  };

  expect(() => {
    requireIndependentTransaction(income, {});
  }).not.toThrow();
  expect(() => {
    requireIndependentTransaction(
      {
        ...income,
        extraTarget: {
          id: "income",
          linkedObjectId: null,
          linkedObjectType: null,
          type: "CATEGORY",
        },
      },
      {}
    );
  }).toThrow(/allocation/u);
});
