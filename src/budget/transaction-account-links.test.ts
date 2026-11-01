/* oxlint-disable func-style -- Named fixture functions follow repository conventions. */
import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import type { Session } from "../auth/session.ts";
import { BeyondClient } from "../firestore/client.ts";
import type { Fetcher } from "../firestore/client.ts";
import { decode, encodeFields } from "../firestore/encoding.ts";
import type { Data } from "../firestore/encoding.ts";
import { TransactionService } from "./transactions.ts";

const BudgetPath = "projects/beyond-budget/databases/(default)/documents/budgets/linkBudget";
const TransactionId = "LinkCompatibility001";
const Timestamp = "2026-11-01T12:00:00.000Z";
const TransactionPath = `${BudgetPath}/transactions/${TransactionId}`;

const SavedAccount = {
  id: "card",
  linkedObjectId: "reserve",
  linkedObjectType: null,
  type: "CREDIT_CARD",
};

async function fixture() {
  const home = await mkdtemp(nodePath.join(tmpdir(), "bebu-account-links-"));

  const session: Session = {
    budgetIds: ["linkBudget"],
    expiresAt: Date.now() + 3_600_000,
    idToken: "synthetic-token",
    importedAt: Timestamp,
    projectId: "beyond-budget",
    stashes: [],
    uid: "linkUser",
    version: 1,
  };

  const transaction = {
    amount: -250,
    autoAllocateIfCapable: true,
    budgetId: "linkBudget",
    cleared: true,
    color: "NONE",
    completed: true,
    createdAt: Timestamp,
    createdBy: { displayName: "Test", email: null, photoUrl: "", uid: "linkUser" },
    dueAt: Timestamp,
    editable: true,
    eventId: null,
    externalId: null,
    extraTarget: null,
    extras: {},
    files: [],
    frequency: "ONE_OFF",
    id: TransactionId,
    integrityCount: 1,
    latitude: null,
    longitude: null,
    nonWorkingDayPolicy: "KEEP_ORIGINAL_DATE",
    notes: "",
    offsetAdjustment: 0,
    payee: null,
    periodId: "november",
    reconciled: false,
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
    targetFrom: structuredClone(SavedAccount),
    targetTo: { id: "old", linkedObjectId: null, linkedObjectType: null, type: "CATEGORY" },
    timezone: "UTC",
    type: "OUTFLOW",
    version: null,
    yearMonth: "2026-11",
  };

  const documents = new Map<string, Data>([
    [
      BudgetPath,
      {
        availablePeriods: { "2026-11": { id: "november" } },
        stashIdentifiers: {
          ACCOUNTS: "accounts",
          GROUPS_AND_CATEGORIES: "categories",
          TRANSACTIONS: "transactions",
        },
      },
    ],
    [
      "projects/beyond-budget/databases/(default)/documents/users/linkUser",
      {
        config: { currencyCode: "PHP" },
      },
    ],
    [
      `${BudgetPath}/stashes/accounts`,
      {
        data: {
          card: {
            balanceAmount: -250,
            currencyCode: "",
            id: "card",
            linkedCategoryId: "reserve",
            name: "Card",
            transactionCount: 1,
            type: "CREDIT_CARD",
            unclearedBalanceAmount: 0,
          },
        },
      },
    ],
    [
      `${BudgetPath}/stashes/categories`,
      {
        data: {
          categories: {
            next: { id: "next", linkedAccountIds: [], transactionCount: 0, type: "DEFAULT" },
            old: { id: "old", linkedAccountIds: [], transactionCount: 1, type: "DEFAULT" },
            reserve: { id: "reserve", linkedAccountIds: ["card"], type: "CREDIT_CARD_PAYMENT" },
          },
        },
      },
    ],
    [
      `${BudgetPath}/periods/november`,
      {
        balances: {
          next: {},
          old: { allocatedAmount: 250, spentAmount: 250 },
          reserve: { otherAmount: 250 },
        },
      },
    ],
    [TransactionPath, transaction],
  ]);

  for (const id of ["card", "old", "next", "november", "transactions"]) {
    documents.set(`${BudgetPath}/stashes/${id}`, {
      data: {
        completedTransactionCount: id === "next" ? 0 : 1,
        completedTransactions: id === "next" ? {} : { [TransactionId]: transaction },
        historicalBalances: { "2026-11": -250 },
        historicalSpending: { "2026-11": id === "next" ? 0 : 250 },
        upcomingTransactions: {},
      },
    });
  }

  const methods: string[] = [];

  const fetcher: Fetcher = async (input, init) => {
    methods.push(init?.method ?? "GET");
    assert.equal(init?.method ?? "GET", "GET", "This fixture permits only read-only planning");
    const path = new URL(new Request(input).url).pathname.slice(4);
    const document = documents.get(path);
    assert.ok(document, `Missing synthetic document ${path}`);

    return await Promise.resolve(
      Response.json({
        createTime: Timestamp,
        fields: encodeFields(document),
        name: path,
        updateTime: Timestamp,
      })
    );
  };

  const service = new TransactionService(new BeyondClient(session, { fetcher }), { home });

  return { documents, home, methods, service };
}

test("category reassignment preserves an explicit null card link type and unchanged ledger effects", async () => {
  const { documents, home, methods, service } = await fixture();

  try {
    const result = await service.update(TransactionId, { categoryId: "next" }, { dryRun: true });
    assert.ok("dryRun" in result);
    const canonical = result.body.writes.find((write) => write.update?.name === TransactionPath);
    assert.ok(canonical?.update);

    const changed = Object.fromEntries(
      Object.entries(canonical.update.fields ?? {}).map(([key, value]) => [key, decode(value)])
    );

    expect(canonical.updateMask?.fieldPaths).toEqual(["targetTo"]);
    expect(changed.targetTo).toEqual({
      id: "next",
      linkedObjectId: null,
      linkedObjectType: null,
      type: "CATEGORY",
    });

    const period = result.body.writes.find(
      (write) => write.update?.name === `${BudgetPath}/periods/november`
    );

    expect(period?.updateTransforms).toEqual([
      { fieldPath: "balances.old.spentAmount", increment: { integerValue: "-250" } },
      { fieldPath: "balances.next.spentAmount", increment: { integerValue: "250" } },
    ]);

    const accounts = result.body.writes.find(
      (write) => write.update?.name === `${BudgetPath}/stashes/accounts`
    );

    expect(accounts).toBeUndefined();
    expect(documents.get(TransactionPath)?.targetFrom).toEqual(SavedAccount);
    expect(methods.every((method) => method === "GET")).toBe(true);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("category update preserves a null legacy creator without assigning the current actor", async () => {
  const { documents, home, service } = await fixture();

  try {
    const saved = documents.get(TransactionPath);
    assert.ok(saved);
    documents.set(TransactionPath, {
      ...saved,
      createdBy: null,
      targetFrom: { ...SavedAccount, linkedObjectType: "CATEGORY" },
    });
    const result = await service.update(TransactionId, { categoryId: "next" }, { dryRun: true });
    assert.ok("dryRun" in result);
    const canonical = result.body.writes.find((write) => write.update?.name === TransactionPath);
    expect(canonical?.updateMask?.fieldPaths).toEqual(["targetTo"]);
    expect(canonical?.update?.fields?.createdBy).toBeUndefined();
    expect(documents.get(TransactionPath)?.createdBy).toBeNull();

    const destination = result.body.writes.find(
      (write) => write.update?.name === `${BudgetPath}/stashes/next`
    );

    assert.ok(destination?.update?.fields?.data);
    expect(decode(destination.update.fields.data)).toMatchObject({
      completedTransactions: { [TransactionId]: { createdByUserId: null } },
    });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test.each(["autoAllocateIfCapable", "version", "createdBy", "linkedObjectType"])(
  "a null creator does not allow absent legacy %s fields",
  async (field) => {
    const { documents, home, methods, service } = await fixture();

    try {
      const saved = documents.get(TransactionPath);
      assert.ok(saved);
      const targetFrom: Data = { ...SavedAccount, linkedObjectType: "CATEGORY" };

      const transaction = Object.fromEntries(
        Object.entries({ ...saved, createdBy: null, targetFrom }).filter(([key]) => key !== field)
      );

      if (field === "linkedObjectType") {
        delete targetFrom.linkedObjectType;
      }

      documents.set(TransactionPath, transaction);
      await assert.rejects(service.update(TransactionId, { categoryId: "next" }, { dryRun: true }));
      expect(methods.every((method) => method === "GET")).toBe(true);
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  }
);

test.each([
  { name: "a non-null version", patch: { version: 1 } },
  { name: "an absent version", patch: {} },
  {
    name: "an unknown link type",
    patch: { targetFrom: { ...SavedAccount, linkedObjectType: "UNKNOWN" } },
  },
  {
    name: "a changed link ID",
    patch: { targetFrom: { ...SavedAccount, linkedObjectId: "different" } },
  },
  { name: "a blank link ID", patch: { targetFrom: { ...SavedAccount, linkedObjectId: "" } } },
  {
    name: "a generic account",
    patch: { targetFrom: { ...SavedAccount, type: "GENERIC_ACCOUNT" } },
  },
  { name: "a noneditable refund", patch: { amount: 250, editable: false, subType: "REFUND" } },
  { name: "a split transaction", patch: { splitId: "split" } },
  { name: "missing reciprocal links", patch: {} },
  { name: "an absent account link", patch: {} },
])("card compatibility rejects $name", async ({ name, patch }) => {
  const { documents, home, methods, service } = await fixture();

  try {
    const saved = documents.get(TransactionPath);
    assert.ok(saved);
    documents.set(TransactionPath, { ...saved, ...patch });

    if (name === "an absent version") {
      const current = documents.get(TransactionPath);
      assert.ok(current);
      delete current.version;
    }

    if (name === "missing reciprocal links") {
      documents.set(`${BudgetPath}/stashes/categories`, {
        data: {
          categories: {
            next: { id: "next", linkedAccountIds: [], type: "DEFAULT" },
            old: { id: "old", linkedAccountIds: [], type: "DEFAULT" },
            reserve: { id: "reserve", linkedAccountIds: [], type: "CREDIT_CARD_PAYMENT" },
          },
        },
      });
    }

    if (name === "an absent account link") {
      documents.set(`${BudgetPath}/stashes/accounts`, {
        data: {
          card: {
            id: "card",
            name: "Card",
            type: "CREDIT_CARD",
          },
        },
      });
    }

    await assert.rejects(service.update(TransactionId, { categoryId: "next" }, { dryRun: true }));
    expect(methods.every((method) => method === "GET")).toBe(true);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});
