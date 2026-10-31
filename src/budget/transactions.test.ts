import { expect, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { captureExecute } from "@crustjs/testing";
import { z } from "zod";

import type { Session } from "../auth/session.ts";
import { createApp } from "../cli/app.ts";
import { BeyondClient } from "../firestore/client.ts";
import type { Fetcher } from "../firestore/client.ts";
import { decode, encodeFields } from "../firestore/encoding.ts";
import type { CommitResult, Data, Write } from "../firestore/encoding.ts";
import { AccountService } from "./accounts.ts";
import { budgetDiagnostics } from "./diagnostics.ts";
import { categoryFunding } from "./funding.ts";
import { TransactionCreateSchema } from "./transaction-model.ts";
import type { TransactionCreate, TransactionPatch } from "./transaction-model.ts";
import { TransactionService } from "./transactions.ts";

const budgetPath = "projects/beyond-budget/databases/(default)/documents/budgets/testBudget";
const transactionId = "AbCdEfGhIjKlMnOpQrSt";
const timestamp = "2026-10-01T12:00:00.000Z";

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

  const fetcher: Fetcher = async (input, init) => {
    const path = new URL(new Request(input).url).pathname.slice(4);
    calls.push({
      body: z.string().safeParse(init?.body).data,
      method: init?.method ?? "GET",
      path,
    });

    if (init?.method !== "GET") {
      throw new Error(`Unexpected write during a dry run: ${path}`);
    }

    const data = documents.get(path);

    if (!data) {
      return await Promise.resolve(
        Response.json(
          { error: { message: "No fixture for this document", status: "NOT_FOUND" } },
          { status: 404 }
        )
      );
    }

    return await Promise.resolve(
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

test.each(["amount", "category", "create", "delete"])(
  "historical %s changes disclose downstream uncertainty and reject execution",
  async (operation) => {
    const { service, documents, calls } = fixture();
    documents.set(budgetPath, {
      ...documents.get(budgetPath),
      availablePeriods: { "2026-10": { id: "periodOne" }, "2026-11": { id: "laterPeriod" } },
    });
    documents.set(`${budgetPath}/periods/laterPeriod`, {
      balances: {
        spend: { allocatedAmount: 0, carriedOverAmount: 12_500, otherAmount: 0, spentAmount: 0 },
      },
    });
    documents.set(`${budgetPath}/stashes/categoriesIndex`, {
      data: {
        categories: {
          cardCategory: {
            id: "cardCategory",
            linkedAccountIds: ["card"],
            type: "CREDIT_CARD_PAYMENT",
          },
          leisure: { carryOverStrategy: "ALL", id: "leisure", type: "DEFAULT" },
          spend: { carryOverStrategy: "ALL", id: "spend", type: "DEFAULT" },
        },
      },
    });
    documents.set(`${budgetPath}/periods/periodOne`, {
      balances: {
        spend: { allocatedAmount: 250, carriedOverAmount: 0, otherAmount: 0, spentAmount: 250 },
      },
    });
    documents.set(`${budgetPath}/stashes/leisure`, {
      data: { completedTransactions: {}, historicalSpending: {} },
    });

    const change = async (dryRun: boolean) => {
      switch (operation) {
        case "category": {
          return await service.update(transactionId, { categoryId: "leisure" }, { dryRun });
        }

        case "create": {
          return await service.create(
            {
              accountId: "cash",
              amountMinor: 300,
              categoryId: "spend",
              completed: true,
              dueAt: timestamp,
            },
            { dryRun }
          );
        }

        case "delete": {
          return await service.delete(transactionId, { dryRun });
        }

        case "amount": {
          return await service.update(transactionId, { amountMinor: 300 }, { dryRun });
        }

        default: {
          throw new Error("Unexpected test operation");
        }
      }
    };

    const preview = await change(true);
    expect(preview).toMatchObject({
      executionSupported: false,
      summary: {
        downstreamCarryover: {
          laterMonths: ["2026-11"],
          status: "unverified",
        },
      },
    });
    expect(
      preview.summary?.downstreamCarryover?.audit.comparisons.find(
        (row) => row.categoryId === "spend"
      )
    ).toMatchObject({
      residualAmount: 12_500,
      status: "discontinuity",
    });
    expect(
      writesFrom(preview).some(
        (write) => write.update?.name === `${budgetPath}/periods/laterPeriod`
      )
    ).toBe(false);
    await assert.rejects(change(false), /Historical funding changes.*carryover/u);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  }
);

test("metadata-only historical previews do not require or rewrite later funding periods", async () => {
  const { service, documents, calls } = fixture();
  documents.set(budgetPath, {
    ...documents.get(budgetPath),
    availablePeriods: { "2026-10": { id: "periodOne" }, "2026-11": { id: "missingPeriod" } },
  });
  const preview = await service.update(transactionId, { notes: "Reviewed" }, { dryRun: true });
  expect(preview).toMatchObject({
    executionSupported: true,
    summary: { downstreamCarryover: null },
  });
  expect(calls.some((call) => call.path.endsWith("/periods/missingPeriod"))).toBe(false);
});

test("an inconsistent transaction month cannot bypass the downstream funding guard", async () => {
  const { service, documents, calls } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    yearMonth: "2027-01",
  });
  await assert.rejects(
    service.update(transactionId, { amountMinor: 300 }),
    /month\/period mismatch/u
  );
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("historical income resources remain guarded even without category balance changes", async () => {
  const { service, documents, calls } = fixture();
  documents.set(budgetPath, {
    ...documents.get(budgetPath),
    availablePeriods: { "2026-10": { id: "periodOne" }, "2026-11": { id: "later" } },
    type: "ZERO_BASED",
  });
  documents.set(`${budgetPath}/periods/later`, { balances: {} });

  const input = TransactionCreateSchema.parse({
    accountId: "cash",
    amountMinor: 125,
    completed: true,
    dueAt: timestamp,
    type: "INFLOW",
  });

  const preview = await service.create(input, { dryRun: true });
  expect(preview).toMatchObject({
    executionSupported: false,
    summary: { downstreamCarryover: { categoryIds: [], resourcePoolAffected: true } },
  });
  await assert.rejects(service.create(input), /Historical funding changes.*carryover/u);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("legacy history pages retain missing values and continue past malformed records", async () => {
  const omitted = new Set([
    "autoAllocateIfCapable",
    "extraTarget",
    "integrityCount",
    "nonWorkingDayPolicy",
    "offsetAdjustment",
    "subType",
  ]);

  const legacy = Object.fromEntries(
    Object.entries({
      ...canonicalTransaction,
      id: "legacy",
      occurrenceChange: {},
      targetFrom: { id: "card", linkedObjectId: "cardCategory", type: "CREDIT_CARD" },
      targetTo: { id: "spend", linkedObjectId: null, type: "CATEGORY" },
    }).filter(([key]) => !omitted.has(key))
  );

  const pages = [
    {
      documents: [legacy, { ...canonicalTransaction, amount: "unknown", id: "malformed" }],
      nextPageToken: "second",
    },
    {
      documents: [{ ...canonicalTransaction, amount: "unknown", id: "malformedAgain" }],
      nextPageToken: "third",
    },
    { documents: [{ ...canonicalTransaction, id: "last" }] },
  ];

  const original = structuredClone(pages);
  const urls: string[] = [];

  const client = new BeyondClient(session, {
    fetcher: async (input, init) => {
      expect(init?.method).toBe("GET");
      urls.push(new Request(input).url);
      const page = pages[urls.length - 1];

      if (!page) {
        throw new Error("Unexpected page request");
      }

      return await Promise.resolve(
        Response.json({
          ...page,
          documents: page.documents.map((record) => ({
            fields: encodeFields(record),
            name: `${budgetPath}/transactions/${z.string().parse(record.id)}`,
          })),
        })
      );
    },
  });

  const service = new TransactionService(client);
  const first = await service.list({ limit: 2 });
  expect(first.transactions).toEqual([legacy]);
  expect(first).toMatchObject({
    diagnostics: [
      { transactionId: "legacy" },
      { issues: [expect.objectContaining({ path: ["amount"] })], transactionId: "malformed" },
    ],
    invalidRecords: [
      {
        data: { amount: "unknown", id: "malformed" },
        document: `${budgetPath}/transactions/malformed`,
      },
    ],
    nextPageToken: "second",
  });
  expect(first.diagnostics[0]?.issues.map((issue) => issue.path)).toEqual([
    ["autoAllocateIfCapable"],
    ["extraTarget"],
    ["integrityCount"],
    ["nonWorkingDayPolicy"],
    ["offsetAdjustment"],
    ["subType"],
    ["targetFrom", "linkedObjectType"],
    ["targetTo", "linkedObjectType"],
  ]);
  assert.ok("nextPageToken" in first);
  const middle = await service.list({ limit: 2, pageToken: first.nextPageToken ?? undefined });
  expect(middle.transactions).toEqual([]);
  expect(middle.invalidRecords).toMatchObject([{ data: { id: "malformedAgain" } }]);
  assert.ok("nextPageToken" in middle);
  expect(middle.nextPageToken).toBe("third");
  const last = await service.list({ limit: 2, pageToken: middle.nextPageToken ?? undefined });
  expect(last.transactions.map((record) => record.id)).toEqual(["last"]);
  assert.ok("nextPageToken" in last);
  expect(last.nextPageToken).toBeNull();
  expect(urls).toHaveLength(3);
  expect(urls[1]).toContain("pageToken=second");
  expect(urls[2]).toContain("pageToken=third");
  expect(pages).toEqual(original);
});

test("account history retains legacy records and identifies malformed query results", async () => {
  const { autoAllocateIfCapable: _capable, ...legacy } = canonicalTransaction;

  const client = new BeyondClient(session, {
    fetcher: async (_input, init) => {
      expect(init?.method).toBe("POST");

      return await Promise.resolve(
        Response.json([
          { readTime: timestamp },
          ...[legacy, { ...canonicalTransaction, amount: "unknown", id: "broken" }].map(
            (record) => ({
              document: {
                fields: encodeFields(record),
                name: `${budgetPath}/transactions/${record.id}`,
              },
            })
          ),
        ])
      );
    },
  });

  const result = await new TransactionService(client).list({ accountId: "card", limit: 1000 });
  expect(result.transactions).toEqual([legacy]);
  expect(result).toMatchObject({
    diagnostics: [{ transactionId }, { transactionId: "broken" }],
    invalidRecords: [{ data: { id: "broken" } }],
    matched: 2,
    scanLimitReached: false,
  });
});

test("an account filter cannot silently ignore a collection continuation token", async () => {
  const { service, calls } = fixture();
  await assert.rejects(
    service.list({ accountId: "card", pageToken: "second" }),
    /Account history does not support page-token/u
  );
  expect(calls).toEqual([]);
});

test("an unsupported Firestore value retains its wire record without concealing its page", async () => {
  const fields = {
    ...encodeFields({ ...canonicalTransaction, id: "unsupported" }),
    extras: {
      mapValue: { fields: { location: { geoPointValue: { latitude: 1, longitude: 2 } } } },
    },
  };

  const client = new BeyondClient(session, {
    fetcher: async () =>
      await Promise.resolve(
        Response.json({
          documents: [
            { fields, name: `${budgetPath}/transactions/unsupported` },
            {
              fields: encodeFields(canonicalTransaction),
              name: `${budgetPath}/transactions/${transactionId}`,
            },
          ],
          nextPageToken: "next",
        })
      ),
  });

  const result = await new TransactionService(client).list();
  expect(result.transactions.map((record) => record.id)).toEqual([transactionId]);
  expect(result).toMatchObject({
    diagnostics: [
      { issues: [{ code: "decode_error", path: ["extras"] }], transactionId: "unsupported" },
    ],
    invalidRecords: [{ document: `${budgetPath}/transactions/unsupported`, fields }],
    nextPageToken: "next",
  });
});

test.each(["update", "delete"] as const)(
  "legacy allocation uncertainty still blocks %s before commit",
  async (operation) => {
    const { service, documents, calls } = fixture();
    const { autoAllocateIfCapable: _capable, ...legacy } = canonicalTransaction;
    documents.set(`${budgetPath}/transactions/${transactionId}`, legacy);
    await assert.rejects(
      operation === "update"
        ? service.update(transactionId, { categoryId: "spend" })
        : service.delete(transactionId),
      /autoAllocateIfCapable/u
    );
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  }
);

test("a category-only change cannot bypass a refund's stored editability restriction", async () => {
  const { service, documents, calls } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    amount: 250,
    editable: false,
    reconciled: false,
    splitId: null,
    subType: "REFUND",
  });
  await assert.rejects(service.update(transactionId, { categoryId: "spend" }), /only editable/u);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("new one-off refunds preserve native noneditability throughout their lifecycle", async () => {
  const { service, documents, calls } = fixture();

  const result = await service.create(
    {
      accountId: "card",
      amountMinor: 100,
      categoryId: "spend",
      dueAt: timestamp,
      id: transactionId,
      type: "REFUND",
    },
    { dryRun: true }
  );

  const write = writesFrom(result).find(
    (entry) => entry.update?.name === `${budgetPath}/transactions/${transactionId}`
  );

  const fields = write?.update?.fields ?? {};
  expect(fields.editable).toEqual({ booleanValue: false });
  expect(result.summary).toMatchObject({ transaction: { after: { editable: false } } });
  documents.set(
    `${budgetPath}/transactions/${transactionId}`,
    Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]))
  );
  await assert.rejects(
    service.update(transactionId, { categoryId: "spend" }, { dryRun: true }),
    /only editable/u
  );
  await assert.rejects(service.delete(transactionId, { dryRun: true }), /only editable/u);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("ordinary one-off deletion cannot bypass a refund's stored editability restriction", async () => {
  const { service, documents, calls } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    amount: 250,
    editable: false,
    subType: "REFUND",
  });
  await assert.rejects(service.delete(transactionId, { dryRun: true }), /only editable/u);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test.each([{ id: "anotherTransaction" }, { budgetId: "anotherBudget" }])(
  "one-off deletion rejects a mismatched canonical identity: %j",
  async (identity) => {
    const { service, documents, calls } = fixture();
    documents.set(`${budgetPath}/transactions/${transactionId}`, {
      ...canonicalTransaction,
      ...identity,
    });
    await assert.rejects(
      service.delete(transactionId, { dryRun: true }),
      /identity does not match/u
    );
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  }
);

test("individual legacy transaction reads preserve omissions without changing write eligibility", async () => {
  const { service, documents, calls } = fixture();
  const { autoAllocateIfCapable: _capable, ...legacy } = canonicalTransaction;
  documents.set(`${budgetPath}/transactions/${transactionId}`, { ...legacy, occurrenceChange: {} });
  const result = await service.transaction(transactionId);
  expect(result.data).toEqual({ ...legacy, occurrenceChange: {} });
  await assert.rejects(service.delete(transactionId, { dryRun: true }), /autoAllocateIfCapable/u);
  await assert.rejects(
    service.update(transactionId, { categoryId: "spend" }, { dryRun: true }),
    /autoAllocateIfCapable/u
  );
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("legacy history preserves an explicitly unknown creator while writes stay strict", async () => {
  const record = { ...canonicalTransaction, createdBy: null };
  const { fetcher, documents } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, record);

  const client = new BeyondClient(structuredClone(session), {
    fetcher: async (input, init) => {
      if (new Request(input).url.includes("/transactions?")) {
        return await Promise.resolve(
          Response.json({
            documents: [
              {
                fields: encodeFields(record),
                name: `${budgetPath}/transactions/${transactionId}`,
              },
            ],
          })
        );
      }

      return await fetcher(input, init);
    },
  });

  const service = new TransactionService(client);
  const history = await service.list();
  expect(history.transactions).toEqual([record]);
  expect(history.invalidRecords).toEqual([]);
  expect(history.diagnostics).toMatchObject([{ issues: [{ path: ["createdBy"] }], transactionId }]);
  await assert.rejects(
    service.update(transactionId, { notes: "reviewed" }, { dryRun: true }),
    /createdBy/u
  );
  await assert.rejects(service.delete(transactionId, { dryRun: true }), /createdBy/u);
});

test.each(["conflict", "lost-response"])(
  "CLI %s failures expose recovery JSON and never replay writes",
  async (failure) => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-conflict-cli-"));
    const previous = process.env.BEBU_SESSION_FILE;
    const { fetcher, documents } = fixture();
    const original = structuredClone(documents);
    let commits = 0;
    const requestId = "abcdefghijklmnopqrst";

    const transport: Fetcher = async (input, init) => {
      if (init?.method === "POST") {
        expect(new Request(input).url).toEndWith("documents:commit");
        commits += 1;

        if (failure === "lost-response") {
          throw new Error("Connection lost");
        }

        return await Promise.resolve(
          Response.json(
            {
              error: {
                message: "the stored version does not match the required base version",
                status: "FAILED_PRECONDITION",
              },
            },
            { status: 400 }
          )
        );
      }

      return await fetcher(input, init);
    };

    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(transport, { preconnect: fetch.preconnect })
    );

    process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

    try {
      await writeFile(process.env.BEBU_SESSION_FILE, JSON.stringify(session));
      const file = nodePath.join(directory, "patch.json");
      await writeFile(file, JSON.stringify({ notes: "reviewed" }));

      const result = await captureExecute(createApp(), [
        "transactions",
        "update",
        transactionId,
        "--file",
        file,
        "--request-id",
        requestId,
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");

      const diagnostic = z
        .object({
          error: z.string(),
          preconditions: z.array(z.object({ document: z.string(), updateTime: z.string() })),
        })
        .loose()
        .parse(JSON.parse(result.stderr));

      expect(diagnostic).toMatchObject({
        conflict: failure === "conflict",
        marker: "absent",
        outcome: failure === "conflict" ? "rejected" : "unknown",
        recovery: failure === "conflict" ? "refresh-preview" : "inspect-before-retry",
        requestId,
      });
      expect(diagnostic.error.length).toBeGreaterThan(0);
      expect(diagnostic.preconditions).toContainEqual({
        document: `${budgetPath}/transactions/${transactionId}`,
        updateTime: timestamp,
      });
      expect(commits).toBe(1);
      expect(documents).toEqual(original);
    } finally {
      fetchMock.mockRestore();

      if (previous === undefined) {
        delete process.env.BEBU_SESSION_FILE;
      } else {
        process.env.BEBU_SESSION_FILE = previous;
      }

      await rm(directory, { force: true, recursive: true });
    }
  }
);

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
  await assert.rejects(service.delete(transactionId), /allocation/u);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("an allocation history map key blocks deletion even when the entry ID is empty", async () => {
  const { service, documents, calls } = fixture();
  documents.set(budgetPath, {
    ...documents.get(budgetPath),
    allocationHistory: { [transactionId]: { id: "", source: "FUTURE_SOURCE", undoneAt: null } },
  });
  await assert.rejects(service.delete(transactionId), /allocation/u);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("established automatic allocation blocks financial changes but permits a notes-only edit", async () => {
  const { service, documents, calls } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    autoAllocateIfCapable: true,
    autoAllocateIfIncome: true,
    extras: { autoAllocated: true },
  });
  await assert.rejects(service.delete(transactionId), /allocation/u);
  await assert.rejects(service.update(transactionId, { cleared: false }), /allocation/u);

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
  await assert.rejects(
    service.create({ accountId: "card", amountMinor: 100, categoryId: "spend", dueAt: timestamp }),
    /link/u
  );
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("clearing a refund cannot apply ordinary income rules and malformed history cannot bypass protection", async () => {
  const { service, documents, calls } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    extras: { refund: true },
  });
  await assert.rejects(service.update(transactionId, { cleared: false }, { dryRun: true }));
  documents.set(`${budgetPath}/transactions/${transactionId}`, canonicalTransaction);
  documents.set(budgetPath, { ...documents.get(budgetPath), allocationHistory: null });
  await assert.rejects(service.delete(transactionId, { dryRun: true }));
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
  });
  expect(writeAt(writes, "stashes/accountsIndex").updateTransforms).toContainValues([
    { fieldPath: "data.card.balanceAmount", increment: { integerValue: "-250" } },
    { fieldPath: "data.card.transactionCount", increment: { integerValue: "1" } },
  ]);
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
  expect(writeAt(writes, "stashes/shop").updateTransforms).toContainValues([
    { fieldPath: "data.historicalBalances.`2026-10`", increment: { integerValue: "-250" } },
    { fieldPath: "data.historicalSpending.`2026-10`", increment: { integerValue: "250" } },
  ]);
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

  expect(writeAt(writes, "stashes/accountsIndex").updateTransforms).toContainValues([
    { fieldPath: "data.cash.balanceAmount", increment: { integerValue: "125" } },
  ]);
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

  expect(writeAt(writes, "stashes/accountsIndex").updateTransforms).toContainValues([
    { fieldPath: "data.cash.balanceAmount", increment: { integerValue: "125" } },
  ]);
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

test("clearing edits move card balances and mirror notes without incrementing integrityCount", async () => {
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
    { fieldPath: "data.card.balanceAmount", increment: { integerValue: "250" } },
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
  expect(writeAt(writes, "stashes/accountsIndex").updateTransforms).toContainValues([
    { fieldPath: "data.card.balanceAmount", increment: { integerValue: "250" } },
    { fieldPath: "data.card.transactionCount", increment: { integerValue: "-1" } },
  ]);
  // Native 51713/51730 decrements completed counts even when the preview was trimmed.
  expect(writeAt(writes, "stashes/transactionsIndex").updateTransforms).toEqual([
    { fieldPath: "data.completedTransactionCount", increment: { integerValue: "-1" } },
  ]);
  expect(writeAt(writes, "stashes/transactionsIndex").updateMask?.fieldPaths).toEqual([]);
  expect(writeAt(writes, "stashes/card").updateMask?.fieldPaths).toContain(
    `data.completedTransactions.${transactionId}`
  );
  expect(writeAt(writes, "stashes/card").update?.fields).toEqual({
    data: { mapValue: { fields: { completedTransactions: { mapValue: { fields: {} } } } } },
  });
});

test("duplicate tags are refused before committing", async () => {
  const { service, calls } = fixture();
  await assert.rejects(
    service.create({
      accountId: "card",
      amountMinor: 100,
      categoryId: "spend",
      dueAt: timestamp,
      tagIds: ["trip", "trip"],
    }),
    /unique IDs/u
  );
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
    fetcher: async (input) => {
      urls.push(new Request(input).url);

      return await Promise.resolve(
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
    fetcher: async (input, init) => {
      expect(new Request(input).url).toBe(
        `https://firestore.googleapis.com/v1/${budgetPath}:runQuery`
      );
      expect(init?.method).toBe("POST");
      query = JSON.parse(await new Request(input, init).text());

      return await Promise.resolve(
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
  await assert.rejects(categoryFunding(client, "2026-13"), /YYYY-MM/u);
  expect(calls).toHaveLength(0);
  await assert.rejects(categoryFunding(client, "2026-09"), /does not exist/u);
  await assert.rejects(categoryFunding(client, "2026-10", "missing"), /Category not found/u);
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
  await assert.rejects(categoryFunding(client, "2026-10"), /safe integer/u);
  documents.set(`${budgetPath}/periods/periodOne`, {
    balances: { spend: { allocatedAmount: 1.5 } },
  });
  await assert.rejects(categoryFunding(client, "2026-10"));
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
        balanceAmount: { after: 10_000, before: 10_000, delta: 0 },
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
        balanceAmount: { after: 0, before: -250, delta: 250 },
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
  const { fetcher, calls, documents } = fixture();

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

    const history = await captureExecute(createApp(), [
      "allocations",
      "history",
      "--month",
      "2026-10",
    ]);

    expect(history.exitCode).toBe(0);
    expect(JSON.parse(history.stdout)).toMatchObject({ entries: [], periodId: "periodOne" });

    const report = await captureExecute(createApp(), [
      "allocations",
      "report",
      "--month",
      "2026-10",
    ]);

    expect(report.exitCode).toBe(0);
    expect(JSON.parse(report.stdout)).toMatchObject({
      allocatedAmount: 50_000,
      positiveAllocatedAmount: 50_000,
    });
    const targets = await captureExecute(createApp(), ["targets", "list", "--month", "2026-10"]);
    expect(targets.exitCode).toBe(0);
    expect(JSON.parse(targets.stdout)).toMatchObject({ periodId: "periodOne", targets: [] });
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

    const result = z
      .object({ body: z.unknown().optional() })
      .loose()
      .parse(JSON.parse(preview.stdout));

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
    expect(JSON.parse(full.stdout)).toHaveProperty("body.writes", expect.any(Array));
    expect(JSON.parse(full.stdout)).toMatchObject({
      summary: { categories: [] },
    });

    documents.set(budgetPath, {
      ...documents.get(budgetPath),
      availablePeriods: { "2026-10": { id: "periodOne" }, "2026-11": { id: "later" } },
    });
    documents.set(`${budgetPath}/periods/later`, { balances: {} });
    await writeFile(payload, JSON.stringify({ amountMinor: 300 }));

    const blocked = await captureExecute(createApp(), [
      "transactions",
      "update",
      transactionId,
      "--budget",
      "testBudget",
      "--file",
      payload,
      "--request-id",
      "historical-change",
      "--compact",
    ]);

    expect(blocked.exitCode).toBe(1);
    expect(JSON.parse(blocked.stderr)).toMatchObject({
      downstreamCarryover: { executionSupported: false, laterMonths: ["2026-11"] },
      executionSupported: false,
      requestId: "historical-change",
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

test("uncleared income changes only the uncleared account balance on creation and deletion", async () => {
  const { service, documents } = fixture();

  const created = writesFrom(
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

  expect(writeAt(created, "stashes/accountsIndex").updateTransforms).toContainEqual({
    fieldPath: "data.cash.unclearedBalanceAmount",
    increment: { integerValue: "125" },
  });
  expect(
    writeAt(created, "stashes/accountsIndex").updateTransforms?.some(
      (t) => t.fieldPath === "data.cash.balanceAmount"
    )
  ).toBe(false);
  expect(
    writeAt(created, "stashes/cash").updateTransforms?.some((t) =>
      t.fieldPath.startsWith("data.historicalBalances")
    )
  ).toBe(false);
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    amount: 125,
    cleared: false,
    targetFrom: null,
    targetTo: { id: "cash", linkedObjectId: null, linkedObjectType: null, type: "GENERIC_ACCOUNT" },
    type: "INFLOW",
  });
  const removed = writesFrom(await service.delete(transactionId, { dryRun: true }));
  expect(writeAt(removed, "stashes/accountsIndex").updateTransforms).toContainEqual({
    fieldPath: "data.cash.unclearedBalanceAmount",
    increment: { integerValue: "-125" },
  });
  expect(
    writeAt(removed, "stashes/accountsIndex").updateTransforms?.some(
      (t) => t.fieldPath === "data.cash.balanceAmount"
    )
  ).toBe(false);
  expect(
    writeAt(removed, "stashes/cash").updateTransforms?.some((t) =>
      t.fieldPath.startsWith("data.historicalBalances")
    ) ?? false
  ).toBe(false);
});

test.each([
  { after: true, before: false, clearedDelta: "125", unclearedDelta: "-125" },
  { after: false, before: true, clearedDelta: "-125", unclearedDelta: "125" },
])(
  "income clearing moves funds between account balances and history: $before to $after",
  async ({ before, after, clearedDelta, unclearedDelta }) => {
    const { service, documents } = fixture();
    documents.set(`${budgetPath}/transactions/${transactionId}`, {
      ...canonicalTransaction,
      amount: 125,
      cleared: before,
      targetFrom: null,
      targetTo: {
        id: "cash",
        linkedObjectId: null,
        linkedObjectType: null,
        type: "GENERIC_ACCOUNT",
      },
      type: "INFLOW",
    });

    const writes = writesFrom(
      await service.update(transactionId, { cleared: after }, { dryRun: true })
    );

    expect(writeAt(writes, "stashes/accountsIndex").updateTransforms).toContainValues([
      { fieldPath: "data.cash.balanceAmount", increment: { integerValue: clearedDelta } },
      {
        fieldPath: "data.cash.unclearedBalanceAmount",
        increment: { integerValue: unclearedDelta },
      },
    ]);
    expect(writeAt(writes, "stashes/cash").updateTransforms).toEqual([
      { fieldPath: "data.historicalBalances.`2026-10`", increment: { integerValue: clearedDelta } },
    ]);
  }
);

test("income history rejects a stored month that differs from its runtime due-date month", async () => {
  const { service, documents, calls } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    amount: 125,
    dueAt: "2026-09-15T12:00:00Z",
    targetFrom: null,
    targetTo: { id: "cash", linkedObjectId: null, linkedObjectType: null, type: "GENERIC_ACCOUNT" },
    type: "INFLOW",
  });
  await assert.rejects(service.delete(transactionId, { dryRun: true }), /month/u);
  await assert.rejects(
    service.update(transactionId, { cleared: false }, { dryRun: true }),
    /month/u
  );
  expect(calls.every((c) => c.method === "GET")).toBe(true);
});

test("amount edits replace card spending and reserves without changing transaction counts", async () => {
  const { service, calls } = fixture();
  const result = await service.update(transactionId, { amountMinor: 50_000 }, { dryRun: true });
  const writes = writesFrom(result);
  expect(writeAt(writes, `transactions/${transactionId}`)).toMatchObject({
    currentDocument: { updateTime: timestamp },
    update: { fields: { amount: { integerValue: "-50000" } } },
  });
  expect(writeAt(writes, "periods/periodOne").updateTransforms).toEqual([
    { fieldPath: "balances.cardCategory.otherAmount", increment: { integerValue: "49750" } },
    { fieldPath: "balances.spend.spentAmount", increment: { integerValue: "49750" } },
  ]);
  expect(writeAt(writes, "stashes/accountsIndex").updateTransforms).toEqual([
    { fieldPath: "data.card.balanceAmount", increment: { integerValue: "-49750" } },
  ]);
  expect(writeAt(writes, "stashes/spend").updateTransforms).toContainEqual({
    fieldPath: "data.historicalSpending.`2026-10`",
    increment: { integerValue: "49750" },
  });

  for (const index of ["transactionsIndex", "periodOne", "card", "spend"]) {
    expect(writeAt(writes, `stashes/${index}`).updateMask?.fieldPaths).toEqual([
      `data.completedTransactions.${transactionId}.amount`,
    ]);
  }

  expect(result.summary).toMatchObject({
    accounts: [{ balanceAmount: { after: -50_000, before: -250, delta: -49_750 }, id: "card" }],
    categories: [
      { after: { availableAmount: 0 }, id: "spend" },
      { after: { otherAmount: 50_000 }, id: "cardCategory" },
    ],
    transaction: { after: { amount: -50_000 }, before: { amount: -250 } },
  });
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("amount and clearing edits replace income effects once using the new amount", async () => {
  const { service, documents } = fixture();
  documents.set(budgetPath, { ...documents.get(budgetPath), type: "ZERO_BASED" });
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    amount: 250,
    payee: { id: "shop", linkedObjectId: null, linkedObjectType: null, type: "PAYEE" },
    tagIds: ["trip"],
    targetFrom: null,
    targetTo: { id: "cash", linkedObjectId: null, linkedObjectType: null, type: "GENERIC_ACCOUNT" },
    type: "INFLOW",
  });

  const writes = writesFrom(
    await service.update(transactionId, { amountMinor: 400, cleared: false }, { dryRun: true })
  );

  expect(writeAt(writes, "stashes/accountsIndex").updateTransforms).toEqual([
    { fieldPath: "data.cash.balanceAmount", increment: { integerValue: "-250" } },
    { fieldPath: "data.cash.unclearedBalanceAmount", increment: { integerValue: "400" } },
  ]);
  expect(writeAt(writes, "periods/periodOne").updateTransforms).toEqual([
    { fieldPath: "allocationAmount", increment: { integerValue: "-250" } },
  ]);
  expect(writeAt(writes, "stashes/cash").updateTransforms).toContainEqual({
    fieldPath: "data.historicalBalances.`2026-10`",
    increment: { integerValue: "-250" },
  });

  for (const id of ["shop", "trip"]) {
    expect(writeAt(writes, `stashes/${id}`).updateTransforms).toEqual([
      { fieldPath: "data.historicalBalances.`2026-10`", increment: { integerValue: "-250" } },
    ]);
  }
});

test("recurring upcoming amount edits change obligations and preserve the saved schedule", async () => {
  const { service, documents } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    completed: false,
    frequency: "MONTHLY",
    repeatCount: 12,
    sequenceCount: 3,
    version: null,
  });

  for (const id of ["transactionsIndex", "periodOne", "card", "spend"]) {
    documents.set(`${budgetPath}/stashes/${id}`, {
      data: { upcomingTransactions: { [transactionId]: { amount: -250, frequency: "MONTHLY" } } },
    });
  }

  documents.set(`${budgetPath}/periods/periodOne`, {
    balances: { spend: { upcomingAmount: 250 } },
  });

  const result = await service.update(
    transactionId,
    { amountMinor: 400, notes: "new bill" },
    { dryRun: true }
  );

  const writes = writesFrom(result);
  expect(writeAt(writes, "periods/periodOne").updateTransforms).toEqual([
    { fieldPath: "balances.spend.upcomingAmount", increment: { integerValue: "150" } },
  ]);
  expect(writes.some((write) => write.update?.name === `${budgetPath}/stashes/accountsIndex`)).toBe(
    false
  );
  expect(
    writeAt(writes, `transactions/${transactionId}`).updateMask?.fieldPaths.toSorted()
  ).toEqual(["amount", "notes"]);

  for (const index of ["transactionsIndex", "periodOne", "card", "spend"]) {
    expect(writeAt(writes, `stashes/${index}`).updateMask?.fieldPaths).toContain(
      `data.upcomingTransactions.${transactionId}.amount`
    );
  }

  expect(result.summary).toMatchObject({
    accounts: [],
    categories: [{ after: { upcomingAmount: 400 }, before: { upcomingAmount: 250 }, id: "spend" }],
  });
});

test("periodless upcoming recurring entries can change amounts and metadata without creating a period", async () => {
  const { service, documents } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    completed: false,
    frequency: "MONTHLY",
    periodId: null,
    version: null,
    yearMonth: "2027-01",
  });
  documents.set(`${budgetPath}/stashes/transactionsIndex`, {
    data: { upcomingTransactions: { [transactionId]: { amount: -250 } } },
  });

  const result = await service.update(
    transactionId,
    { amountMinor: 500, cleared: false, color: "BLUE" },
    { dryRun: true }
  );

  const writes = writesFrom(result);
  expect(
    writes
      .filter((write) => write.update?.name.includes("/saveMarkers/") !== true)
      .map((write) => write.update?.name)
  ).toEqual([
    `${budgetPath}/transactions/${transactionId}`,
    `${budgetPath}/stashes/transactionsIndex`,
  ]);
  expect(writeAt(writes, `transactions/${transactionId}`).update?.fields?.amount).toEqual({
    integerValue: "-500",
  });
  expect(result.summary).toMatchObject({ accounts: [], categories: [] });
});

test("amount edits reject established allocation effects and unsafe amounts before committing", async () => {
  const { service, documents, calls } = fixture();
  await Promise.all(
    [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(async (amountMinor) => {
      await assert.rejects(service.update(transactionId, { amountMinor }, { dryRun: true }));
    })
  );
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    extras: { autoAllocated: true },
  });
  await assert.rejects(
    service.update(transactionId, { amountMinor: 300 }, { dryRun: true }),
    /allocation/u
  );
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("moving an upcoming bill to another month reverses the old obligation and updates both indexes", async () => {
  const { service, documents } = fixture();
  documents.set(budgetPath, {
    ...documents.get(budgetPath),
    availablePeriods: { "2026-10": { id: "periodOne" }, "2026-11": { id: "periodTwo" } },
  });
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    completed: false,
    frequency: "MONTHLY",
    version: null,
  });
  documents.set(`${budgetPath}/periods/periodOne`, {
    balances: { spend: { upcomingAmount: 250 } },
  });
  documents.set(`${budgetPath}/periods/periodTwo`, {
    balances: { spend: { upcomingAmount: 100 } },
  });

  for (const index of ["transactionsIndex", "periodOne", "card", "spend"]) {
    documents.set(`${budgetPath}/stashes/${index}`, {
      data: { upcomingTransactions: { [transactionId]: { amount: -250 } } },
    });
  }

  documents.set(`${budgetPath}/stashes/periodTwo`, { data: { upcomingTransactions: {} } });

  const result = await service.update(
    transactionId,
    {
      amountMinor: 400,
      dueAt: "2026-11-20T12:00:00Z",
      frequency: "FORTNIGHTLY",
      nonWorkingDayPolicy: "SHIFT_TO_PREVIOUS_AVAILABLE_WORKDAY",
      repeatCount: 8,
    },
    { dryRun: true }
  );

  const writes = writesFrom(result);
  expect(writeAt(writes, "periods/periodOne").updateTransforms).toEqual([
    { fieldPath: "balances.spend.upcomingAmount", increment: { integerValue: "-250" } },
  ]);
  expect(writeAt(writes, "periods/periodTwo").updateTransforms).toEqual([
    { fieldPath: "balances.spend.upcomingAmount", increment: { integerValue: "400" } },
  ]);
  expect(writeAt(writes, `transactions/${transactionId}`).update?.fields).toMatchObject({
    dueAt: { timestampValue: "2026-11-20T12:00:00.000Z" },
    frequency: { stringValue: "FORTNIGHTLY" },
    periodId: { stringValue: "periodTwo" },
    repeatCount: { integerValue: "8" },
    yearMonth: { stringValue: "2026-11" },
  });
  expect(writeAt(writes, "stashes/periodOne").updateMask?.fieldPaths).toEqual([
    `data.upcomingTransactions.${transactionId}`,
  ]);
  expect(writeAt(writes, "stashes/periodOne").update?.fields).toEqual({
    data: { mapValue: { fields: { upcomingTransactions: { mapValue: { fields: {} } } } } },
  });
  expect(writeAt(writes, "stashes/periodTwo").updateMask?.fieldPaths).toEqual([
    `data.upcomingTransactions.${transactionId}`,
  ]);
  expect(
    result.summary?.categories.find((category) => category.yearMonth === "2026-10")
  ).toMatchObject({ after: { upcomingAmount: 0 }, before: { upcomingAmount: 250 } });
  expect(
    result.summary?.categories.find((category) => category.yearMonth === "2026-11")
  ).toMatchObject({ after: { upcomingAmount: 500 }, before: { upcomingAmount: 100 } });
});

test("account, category, payee, and tag edits move spending, reserves, history, and usage counts", async () => {
  const { service, documents } = fixture();
  const categories = documents.get(`${budgetPath}/stashes/categoriesIndex`);
  documents.set(`${budgetPath}/stashes/categoriesIndex`, {
    data: {
      categories: {
        ...z
          .object({ data: z.object({ categories: z.record(z.string(), z.unknown()) }) })
          .parse(categories).data.categories,
        food: { id: "food", transactionCount: 0, type: "DEFAULT" },
      },
    },
  });
  documents.set(`${budgetPath}/stashes/food`, {
    data: { completedTransactionCount: 0, completedTransactions: {}, historicalSpending: {} },
  });

  const result = await service.update(
    transactionId,
    { accountId: "cash", categoryId: "food", payeeId: "shop", tagIds: ["trip"] },
    { dryRun: true }
  );

  const writes = writesFrom(result);
  expect(writeAt(writes, "stashes/accountsIndex").updateTransforms).toContainValues([
    { fieldPath: "data.card.balanceAmount", increment: { integerValue: "250" } },
    { fieldPath: "data.cash.balanceAmount", increment: { integerValue: "-250" } },
    { fieldPath: "data.card.transactionCount", increment: { integerValue: "-1" } },
    { fieldPath: "data.cash.transactionCount", increment: { integerValue: "1" } },
  ]);
  expect(writeAt(writes, "periods/periodOne").updateTransforms).toContainValues([
    { fieldPath: "balances.cardCategory.otherAmount", increment: { integerValue: "-250" } },
    { fieldPath: "balances.spend.spentAmount", increment: { integerValue: "-250" } },
    { fieldPath: "balances.food.spentAmount", increment: { integerValue: "250" } },
  ]);
  expect(writeAt(writes, "stashes/food").updateTransforms).toContainValues([
    { fieldPath: "data.historicalSpending.`2026-10`", increment: { integerValue: "250" } },
    { fieldPath: "data.completedTransactionCount", increment: { integerValue: "1" } },
  ]);

  for (const index of ["shop", "trip"]) {
    expect(writeAt(writes, `stashes/${index}`).updateMask?.fieldPaths).toContain(
      `data.completedTransactions.${transactionId}`
    );
  }

  expect(writeAt(writes, "stashes/payeesIndex").updateTransforms).toEqual([
    { fieldPath: "data.shop.transactionCount", increment: { integerValue: "1" } },
  ]);
  expect(writeAt(writes, "stashes/tagsIndex").updateTransforms).toEqual([
    { fieldPath: "data.trip.transactionCount", increment: { integerValue: "1" } },
  ]);
  expect(result.summary?.accounts.map((account) => account.id).toSorted()).toEqual([
    "card",
    "cash",
  ]);
  expect(result.summary?.categories.map((category) => category.id).toSorted()).toEqual([
    "cardCategory",
    "food",
    "spend",
  ]);
});

test("date edits use the transaction timezone and permit upcoming months with no saved period", async () => {
  const { service, documents } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    completed: false,
    frequency: "MONTHLY",
  });

  const result = await service.update(
    transactionId,
    { dueAt: "2026-12-31T20:00:00Z", frequency: "ONE_OFF", timezone: "Asia/Manila" },
    { dryRun: true }
  );

  const fields = writeAt(writesFrom(result), `transactions/${transactionId}`).update?.fields;
  expect(fields).toMatchObject({
    frequency: { stringValue: "ONE_OFF" },
    periodId: { nullValue: null },
    yearMonth: { stringValue: "2027-01" },
  });
  expect(
    writesFrom(result).filter((write) => write.update?.name.includes("/periods/") === true)
  ).toHaveLength(1);
  await assert.rejects(service.update(transactionId, { timezone: "Not/AZone" }, { dryRun: true }));
});

test("recurring metadata edits preserve series identity and schedule without ledger writes", async () => {
  const { service, documents } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    frequency: "MONTHLY",
    repeatCount: 10,
    sequenceCount: 4,
  });

  const result = await service.update(
    transactionId,
    {
      latitude: 14.6,
      longitude: 121,
      notes: "reviewed",
      reminderDescription: "Review amount",
      reminderEnabled: true,
      reminderName: "Bill",
      sentiment: "THUMBS_UP",
    },
    { dryRun: true }
  );

  const writes = writesFrom(result);
  expect(
    writeAt(writes, `transactions/${transactionId}`).updateMask?.fieldPaths.toSorted()
  ).toEqual([
    "latitude",
    "longitude",
    "notes",
    "reminderDescription",
    "reminderEnabled",
    "reminderName",
    "sentiment",
  ]);
  expect(
    writes.every(
      (write) => write.updateTransforms?.some((transform) => "increment" in transform) !== true
    )
  ).toBe(true);
  expect(result.summary?.transaction.after).toMatchObject({
    frequency: "MONTHLY",
    reminderEnabled: true,
    repeatCount: 10,
    sentiment: "THUMBS_UP",
    sequenceCount: 4,
  });
});

test("recurrence edits normalize workdays and retain month-end anchors", async () => {
  const { service, documents } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    anchorDay: 31,
    completed: false,
    dueAt: "2030-02-28T12:00:00Z",
    frequency: "MONTHLY",
    periodId: null,
    repeatCount: 8,
    sequenceCount: 4,
    yearMonth: "2030-02",
  });

  const shifted = writesFrom(
    await service.update(
      transactionId,
      { dueAt: "2030-03-31T12:00:00Z", nonWorkingDayPolicy: "SHIFT_TO_NEXT_AVAILABLE_WORKDAY" },
      { dryRun: true }
    )
  );

  expect(writeAt(shifted, `transactions/${transactionId}`).update?.fields).toMatchObject({
    dueAt: { timestampValue: "2030-04-01T12:00:00.000Z" },
    offsetAdjustment: { integerValue: "1" },
    yearMonth: { stringValue: "2030-04" },
  });
  expect(writeAt(shifted, `transactions/${transactionId}`).updateMask?.fieldPaths).not.toContain(
    "anchorDay"
  );

  const frequency = writesFrom(
    await service.update(transactionId, { frequency: "WEEKLY" }, { dryRun: true })
  );

  expect(writeAt(frequency, `transactions/${transactionId}`).update?.fields).toMatchObject({
    anchorDay: { nullValue: null },
    repeatCount: { nullValue: null },
    sequenceCount: { integerValue: "1" },
  });

  const repeat = writesFrom(
    await service.update(transactionId, { repeatCount: 2 }, { dryRun: true })
  );

  expect(writeAt(repeat, `transactions/${transactionId}`).update?.fields?.repeatCount).toEqual({
    integerValue: "5",
  });

  const unlimited = writesFrom(
    await service.update(transactionId, { repeatCount: 0 }, { dryRun: true })
  );

  expect(writeAt(unlimited, `transactions/${transactionId}`).update?.fields?.repeatCount).toEqual({
    nullValue: null,
  });
});

test("recurring amount edits can affect one payment or the remaining series", async () => {
  const { service, documents } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    completed: false,
    dueAt: "2030-02-28T12:00:00Z",
    frequency: "MONTHLY",
    periodId: null,
    yearMonth: "2030-02",
  });

  const single = writesFrom(
    await service.update(
      transactionId,
      { amountMinor: 400, recurrenceScope: "THIS_PAYMENT" },
      { dryRun: true }
    )
  );

  expect(writeAt(single, `transactions/${transactionId}`).update?.fields?.occurrenceChange).toEqual(
    {
      mapValue: {
        fields: {
          amount: { integerValue: "-400" },
          dueAt: { nullValue: null },
          seriesAmount: { integerValue: "-250" },
          seriesAnchorAt: { nullValue: null },
        },
      },
    }
  );
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...documents.get(`${budgetPath}/transactions/${transactionId}`),
    amount: -400,
    occurrenceChange: { amount: -400, dueAt: null, seriesAmount: -250, seriesAnchorAt: null },
  });

  const series = writesFrom(
    await service.update(
      transactionId,
      { amountMinor: 500, recurrenceScope: "THIS_AND_LATER" },
      { dryRun: true }
    )
  );

  expect(writeAt(series, `transactions/${transactionId}`).update?.fields?.occurrenceChange).toEqual(
    { nullValue: null }
  );
});

test("one-payment date overrides retain the series anchor and encode canonical and index dates as timestamps", async () => {
  const { service, documents, calls } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    anchorDay: 31,
    completed: false,
    dueAt: "2030-02-28T12:00:00Z",
    frequency: "MONTHLY",
    periodId: null,
    yearMonth: "2030-02",
  });
  documents.set(`${budgetPath}/stashes/transactionsIndex`, {
    data: { upcomingTransactions: { [transactionId]: { amount: -250 } } },
  });

  const writes = writesFrom(
    await service.update(
      transactionId,
      { dueAt: "2030-03-15T12:00:00Z", recurrenceScope: "THIS_PAYMENT" },
      { dryRun: true }
    )
  );

  expect(writeAt(writes, `transactions/${transactionId}`).update?.fields?.occurrenceChange).toEqual(
    {
      mapValue: {
        fields: {
          amount: { nullValue: null },
          dueAt: { timestampValue: "2030-03-15T12:00:00.000Z" },
          seriesAmount: { nullValue: null },
          seriesAnchorAt: { timestampValue: "2030-02-28T12:00:00.000Z" },
        },
      },
    }
  );
  expect(writeAt(writes, `transactions/${transactionId}`).updateMask?.fieldPaths).not.toContain(
    "anchorDay"
  );
  expect(writeAt(writes, "stashes/transactionsIndex").updateMask?.fieldPaths).toContain(
    `data.upcomingTransactions.${transactionId}.seriesAnchorAt`
  );
  expect(
    calls.filter((call) => call.path === `${budgetPath}/transactions/${transactionId}`)
  ).toHaveLength(1);
});

test("workday edits preserve local time across daylight-saving changes and do not compound old shifts", async () => {
  const { service, documents } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    completed: false,
    dueAt: "2030-03-11T05:30:00Z",
    frequency: "WEEKLY",
    nonWorkingDayPolicy: "SHIFT_TO_NEXT_AVAILABLE_WORKDAY",
    offsetAdjustment: 1,
    periodId: null,
    timezone: "America/New_York",
    yearMonth: "2030-03",
  });

  const shifted = writesFrom(
    await service.update(
      transactionId,
      { nonWorkingDayPolicy: "SHIFT_TO_PREVIOUS_AVAILABLE_WORKDAY" },
      { dryRun: true }
    )
  );

  expect(writeAt(shifted, `transactions/${transactionId}`).update?.fields).toMatchObject({
    dueAt: { timestampValue: "2030-03-08T06:30:00.000Z" },
    offsetAdjustment: { integerValue: "-2" },
  });

  const next = writesFrom(
    await service.update(transactionId, { dueAt: "2030-03-10T06:30:00Z" }, { dryRun: true })
  );

  expect(writeAt(next, `transactions/${transactionId}`).updateMask?.fieldPaths).not.toContain(
    "dueAt"
  );
});

const InvalidEdits: { changes: TransactionPatch; message: string }[] = [
  { changes: { frequency: "MONTHLY" }, message: "upcoming" },
  { changes: { repeatCount: 3 }, message: "upcoming" },
  { changes: { nonWorkingDayPolicy: "SHIFT_TO_NEXT_AVAILABLE_WORKDAY" }, message: "upcoming" },
  { changes: { tagIds: ["trip", "trip"] }, message: "unique" },
  { changes: { payeeId: "missing" }, message: "Payee" },
  { changes: { categoryId: "cardCategory" }, message: "Special categories" },
];

test.each(InvalidEdits)(
  "invalid edits fail before a commit: $message",
  async ({ changes, message }) => {
    const { service, calls } = fixture();
    await assert.rejects(
      service.update(transactionId, changes, { dryRun: true }),
      new RegExp(RegExp.escape(message), "u")
    );
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  }
);

test("CLI update accepts amounts and recurrence fields and previews the complete result", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-edit-cli-"));
  const previous = process.env.BEBU_SESSION_FILE;
  const { fetcher, documents, calls } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    completed: false,
    dueAt: "2030-02-28T12:00:00Z",
    frequency: "MONTHLY",
    periodId: null,
    yearMonth: "2030-02",
  });

  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fetcher, { preconnect: fetch.preconnect })
  );

  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    await writeFile(process.env.BEBU_SESSION_FILE, JSON.stringify(session));
    const file = nodePath.join(directory, "edit.json");
    await writeFile(
      file,
      JSON.stringify({
        amountMinor: 500,
        dueAt: "2030-03-15T12:00:00Z",
        frequency: "WEEKLY",
        recurrenceScope: "THIS_AND_LATER",
        repeatCount: 12,
      })
    );

    const result = await captureExecute(createApp(), [
      "transactions",
      "update",
      transactionId,
      "--file",
      file,
      "--dry-run",
      "--full",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toHaveProperty("body.writes", expect.any(Array));
    expect(JSON.parse(result.stdout)).toMatchObject({
      dryRun: true,
      summary: {
        transaction: {
          after: {
            amount: -500,
            dueAt: "2030-03-15T12:00:00.000Z",
            frequency: "WEEKLY",
            repeatCount: 12,
          },
        },
      },
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

test("native omitted override fields and invalid old anchors do not prevent a recurring edit", async () => {
  const { service, documents } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    amount: -400,
    anchorDay: 0,
    completed: false,
    dueAt: "2030-02-28T12:00:00Z",
    frequency: "MONTHLY",
    occurrenceChange: { amount: -400, seriesAmount: -250 },
    periodId: null,
    yearMonth: "2030-02",
  });

  const writes = writesFrom(
    await service.update(transactionId, { dueAt: "2030-03-31T12:00:00Z" }, { dryRun: true })
  );

  expect(writeAt(writes, `transactions/${transactionId}`).update?.fields?.anchorDay).toEqual({
    integerValue: "31",
  });
});

test("an upcoming one-off entry can become recurring with an explicit series scope", async () => {
  const { service, documents } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    completed: false,
    dueAt: "2030-02-28T12:00:00Z",
    periodId: null,
    yearMonth: "2030-02",
  });

  const result = await service.update(
    transactionId,
    { frequency: "MONTHLY", recurrenceScope: "THIS_AND_LATER" },
    { dryRun: true }
  );

  expect(result.summary?.transaction.after).toMatchObject({
    anchorDay: 28,
    frequency: "MONTHLY",
    sequenceCount: 1,
  });
});

test.each([
  { allocated: 0, available: -250, name: "unfunded" },
  { allocated: 100, available: -150, name: "partially funded" },
  { allocated: -50, available: -300, name: "already overspent" },
])(
  "$name historical card purchases record spending and the full native reserve",
  async ({ allocated, available }) => {
    const { service, documents, calls } = fixture();
    documents.set(`${budgetPath}/periods/periodOne`, {
      allocationAmount: 0,
      balances: { cardCategory: { otherAmount: 0 }, spend: { allocatedAmount: allocated } },
    });

    const result = await service.create(
      {
        accountId: "card",
        amountMinor: 250,
        categoryId: "spend",
        cleared: true,
        completed: true,
        dueAt: timestamp,
        id: transactionId,
      },
      { dryRun: true }
    );

    const writes = writesFrom(result);
    expect(writeAt(writes, `transactions/${transactionId}`).update?.fields?.dueAt).toEqual({
      timestampValue: timestamp,
    });
    expect(writeAt(writes, "periods/periodOne").updateTransforms).toEqual([
      { fieldPath: "balances.cardCategory.otherAmount", increment: { integerValue: "250" } },
      { fieldPath: "balances.spend.spentAmount", increment: { integerValue: "250" } },
    ]);
    expect(writeAt(writes, "stashes/card").updateTransforms).toContainEqual({
      fieldPath: "data.historicalBalances.`2026-10`",
      increment: { integerValue: "-250" },
    });
    expect(result.summary).toMatchObject({
      accounts: [
        { balanceAmount: { delta: -250 }, id: "card", unclearedBalanceAmount: { delta: 0 } },
      ],
      allocationResources: { after: 0, before: 0, delta: 0 },
      automaticAllocation: false,
      categories: [
        { after: { availableAmount: available, spentAmount: 250 }, id: "spend" },
        { after: { otherAmount: 250 }, id: "cardCategory" },
      ],
    });
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  }
);

test("editing and deleting an overspent card purchase reverses the full native reserve", async () => {
  const { service, documents } = fixture();
  documents.set(`${budgetPath}/periods/periodOne`, {
    balances: {
      cardCategory: { otherAmount: 250 },
      spend: { allocatedAmount: 100, spentAmount: 250 },
    },
  });
  const edited = await service.update(transactionId, { amountMinor: 400 }, { dryRun: true });
  expect(edited.summary).toMatchObject({
    categories: [
      {
        after: { availableAmount: -300, spentAmount: 400 },
        before: { availableAmount: -150 },
        id: "spend",
      },
      { after: { otherAmount: 400 }, id: "cardCategory" },
    ],
  });
  const deleted = await service.delete(transactionId, { dryRun: true });
  expect(deleted.summary).toMatchObject({
    categories: [
      { after: { availableAmount: 100, spentAmount: 0 }, id: "spend" },
      { after: { otherAmount: 0 }, id: "cardCategory" },
    ],
  });
});

test.each([true, false])(
  "card refunds restore category funds and reduce reserves when cleared=%s",
  async (cleared) => {
    const { service, documents, calls } = fixture();
    documents.set(budgetPath, { ...documents.get(budgetPath), type: "ZERO_BASED" });

    const result = await service.create(
      {
        accountId: "card",
        amountMinor: 100,
        categoryId: "spend",
        cleared,
        completed: true,
        dueAt: timestamp,
        id: transactionId,
        payeeId: "shop",
        tagIds: ["trip"],
        type: "REFUND",
      },
      { dryRun: true }
    );

    const writes = writesFrom(result);
    expect(writeAt(writes, `transactions/${transactionId}`)).toMatchObject({
      currentDocument: { exists: false },
      update: {
        fields: {
          amount: { integerValue: "100" },
          dueAt: { timestampValue: timestamp },
          subType: { stringValue: "REFUND" },
          targetFrom: { mapValue: { fields: { id: { stringValue: "card" } } } },
          targetTo: { mapValue: { fields: { id: { stringValue: "spend" } } } },
          type: { stringValue: "OUTFLOW" },
        },
      },
    });
    expect(writeAt(writes, "stashes/accountsIndex").updateTransforms).toContainEqual({
      fieldPath: cleared ? "data.card.balanceAmount" : "data.card.unclearedBalanceAmount",
      increment: { integerValue: "100" },
    });
    expect(writeAt(writes, "periods/periodOne").updateTransforms).toEqual([
      { fieldPath: "balances.cardCategory.otherAmount", increment: { integerValue: "-100" } },
      { fieldPath: "balances.spend.spentAmount", increment: { integerValue: "-100" } },
    ]);
    expect(writeAt(writes, "stashes/spend").updateTransforms).toContainEqual({
      fieldPath: "data.historicalSpending.`2026-10`",
      increment: { integerValue: "-100" },
    });

    for (const id of ["card", "shop", "trip"]) {
      const history = writeAt(writes, `stashes/${id}`).updateTransforms ?? [];
      expect(history.some((entry) => entry.fieldPath === "data.historicalBalances.`2026-10`")).toBe(
        cleared
      );

      if (cleared) {
        expect(history).toContainEqual({
          fieldPath: "data.historicalBalances.`2026-10`",
          increment: { integerValue: "100" },
        });
      }

      if (id !== "card") {
        expect(history).toContainEqual({
          fieldPath: "data.historicalSpending.`2026-10`",
          increment: { integerValue: "100" },
        });
      }
    }

    for (const id of ["transactionsIndex", "periodOne", "card", "spend", "shop", "trip"]) {
      expect(writeAt(writes, `stashes/${id}`).updateMask?.fieldPaths).toContain(
        `data.completedTransactions.${transactionId}`
      );
    }

    expect(result.summary).toMatchObject({
      accounts: [
        {
          balanceAmount: { delta: cleared ? 100 : 0 },
          id: "card",
          unclearedBalanceAmount: { delta: cleared ? 0 : 100 },
        },
      ],
      allocationPeriods: [],
      allocationResources: { delta: 0 },
      categories: [
        { after: { availableAmount: 49_850, spentAmount: 150 }, id: "spend" },
        { after: { otherAmount: 150 }, id: "cardCategory" },
      ],
      transaction: { after: { amount: 100, subType: "REFUND", type: "OUTFLOW" } },
    });
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  }
);

test("refund edits preserve their sign and delete reverses debt, spending, reserve, and history", async () => {
  const { service, documents } = fixture();
  documents.set(`${budgetPath}/transactions/${transactionId}`, {
    ...canonicalTransaction,
    amount: 100,
    subType: "REFUND",
  });

  const edited = await service.update(
    transactionId,
    { amountMinor: 400, cleared: false },
    { dryRun: true }
  );

  expect(edited.summary).toMatchObject({
    accounts: [{ balanceAmount: { delta: -100 }, unclearedBalanceAmount: { delta: 400 } }],
    categories: [
      { after: { spentAmount: -50 }, id: "spend" },
      { after: { otherAmount: -50 }, id: "cardCategory" },
    ],
    transaction: { after: { amount: 400, subType: "REFUND" } },
  });
  expect(writeAt(writesFrom(edited), "stashes/card").updateTransforms).toEqual([
    { fieldPath: "data.historicalBalances.`2026-10`", increment: { integerValue: "-100" } },
  ]);
  const deleted = await service.delete(transactionId, { dryRun: true });
  expect(deleted.summary).toMatchObject({
    accounts: [{ balanceAmount: { delta: -100 } }],
    categories: [
      { after: { spentAmount: 350 }, id: "spend" },
      { after: { otherAmount: 350 }, id: "cardCategory" },
    ],
  });
  expect(writeAt(writesFrom(deleted), "stashes/spend").updateTransforms).toContainEqual({
    fieldPath: "data.historicalSpending.`2026-10`",
    increment: { integerValue: "100" },
  });
});

test("card refund inputs require an expense category and cannot use income or another account type", async () => {
  const { service, calls } = fixture();
  await assert.rejects(
    service.create(
      { accountId: "card", amountMinor: 100, dueAt: timestamp, type: "REFUND" },
      { dryRun: true }
    ),
    /categoryId/u
  );
  await assert.rejects(
    service.create(
      {
        accountId: "cash",
        amountMinor: 100,
        categoryId: "spend",
        dueAt: timestamp,
        type: "REFUND",
      },
      { dryRun: true }
    ),
    /credit-card/u
  );
  await assert.rejects(
    service.create(
      { accountId: "card", amountMinor: 100, dueAt: timestamp, type: "INFLOW" },
      { dryRun: true }
    ),
    /REFUND/u
  );
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("a prior-month unfunded card purchase retains its date without historical allocation data", async () => {
  const { service, documents, calls } = fixture();
  documents.set(budgetPath, {
    ...documents.get(budgetPath),
    availablePeriods: { "2026-09": { id: "periodOne" } },
  });
  documents.set(`${budgetPath}/periods/periodOne`, { balances: {} });

  const result = await service.create(
    {
      accountId: "card",
      amountMinor: 250,
      categoryId: "spend",
      completed: true,
      dueAt: "2026-09-10T12:00:00Z",
      id: transactionId,
    },
    { dryRun: true }
  );

  const writes = writesFrom(result);
  expect(writeAt(writes, `transactions/${transactionId}`).update?.fields).toMatchObject({
    dueAt: { timestampValue: "2026-09-10T12:00:00.000Z" },
    periodId: { stringValue: "periodOne" },
    yearMonth: { stringValue: "2026-09" },
  });
  expect(writeAt(writes, "stashes/spend").updateTransforms).toContainEqual({
    fieldPath: "data.historicalSpending.`2026-09`",
    increment: { integerValue: "250" },
  });
  expect(result.summary).toMatchObject({
    categories: [
      { after: { availableAmount: -250 }, id: "spend", yearMonth: "2026-09" },
      { after: { otherAmount: 250 }, id: "cardCategory", yearMonth: "2026-09" },
    ],
  });
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("linked expense categories cannot silently omit native linked-account effects", async () => {
  const { service, documents, calls } = fixture();
  documents.set(`${budgetPath}/stashes/categoriesIndex`, {
    data: {
      categories: {
        cardCategory: {
          id: "cardCategory",
          linkedAccountIds: ["card"],
          type: "CREDIT_CARD_PAYMENT",
        },
        spend: { id: "spend", linkedAccountIds: ["cash"], type: "DEFAULT" },
      },
    },
  });
  await assert.rejects(
    service.create(
      {
        accountId: "card",
        amountMinor: 100,
        categoryId: "spend",
        dueAt: timestamp,
        type: "REFUND",
      },
      { dryRun: true }
    ),
    /linked-account/u
  );
  await assert.rejects(
    service.update(transactionId, { amountMinor: 100 }, { dryRun: true }),
    /linked-account/u
  );
  await assert.rejects(service.delete(transactionId, { dryRun: true }), /linked-account/u);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("CLI create accepts a card refund and exposes its signed dry-run ledger", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-refund-cli-"));
  const previous = process.env.BEBU_SESSION_FILE;
  const { fetcher, calls } = fixture();

  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fetcher, { preconnect: fetch.preconnect })
  );

  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    await writeFile(process.env.BEBU_SESSION_FILE, JSON.stringify(session));
    const file = nodePath.join(directory, "refund.json");
    await writeFile(
      file,
      JSON.stringify({
        accountId: "card",
        amountMinor: 100,
        categoryId: "spend",
        dueAt: timestamp,
        type: "REFUND",
      })
    );

    const result = await captureExecute(createApp(), [
      "transactions",
      "create",
      "--file",
      file,
      "--dry-run",
      "--full",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      dryRun: true,
      summary: {
        accounts: [{ balanceAmount: { delta: 100 }, id: "card" }],
        transaction: { after: { amount: 100, subType: "REFUND", type: "OUTFLOW" } },
      },
    });
    expect(JSON.parse(result.stdout)).toHaveProperty("body.writes", expect.any(Array));
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

test.each([
  { amount: 100, subType: null },
  { amount: -100, subType: "REFUND" },
  { amount: 0, subType: null },
])(
  "unexpected signed amounts cannot be edited or reversed: $amount $subType",
  async ({ amount, subType }) => {
    const { service, documents, calls } = fixture();
    documents.set(`${budgetPath}/transactions/${transactionId}`, {
      ...canonicalTransaction,
      amount,
      subType,
    });
    await assert.rejects(service.update(transactionId, { amountMinor: 100 }, { dryRun: true }));
    await assert.rejects(service.delete(transactionId, { dryRun: true }));
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  }
);

test.each([
  "DAILY",
  "WEEKLY",
  "FORTNIGHTLY",
  "FOUR_WEEKLY",
  "MONTHLY",
  "TWO_MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "ANNUALLY",
  "BIENNIALLY",
])(
  "creating %s recurrence saves an initial upcoming entry and mirrors its schedule",
  async (frequency) => {
    const { service, calls } = fixture();

    const input = {
      accountId: "card",
      amountMinor: 300,
      categoryId: "spend",
      dueAt: timestamp,
      frequency,
      id: transactionId,
      payeeId: "shop",
      tagIds: ["trip"],
    } satisfies TransactionCreate;

    const result = await service.create(input, { dryRun: true });
    const writes = writesFrom(result);
    expect(writeAt(writes, `transactions/${transactionId}`)).toMatchObject({
      currentDocument: { exists: false },
      update: {
        fields: {
          clonedToTransactionId: { nullValue: null },
          completed: { booleanValue: false },
          frequency: { stringValue: frequency },
          occurrenceChange: { nullValue: null },
          repeatCount: { nullValue: null },
          sequenceCount: { integerValue: "1" },
          version: { nullValue: null },
        },
      },
    });
    expect(result.summary).toMatchObject({
      accounts: [],
      transaction: {
        after: {
          completed: false,
          frequency,
          sequenceCount: 1,
        },
      },
    });
    expect(writeAt(writes, "periods/periodOne").updateTransforms).toEqual([
      { fieldPath: "balances.spend.upcomingAmount", increment: { integerValue: "300" } },
    ]);

    for (const index of ["transactionsIndex", "periodOne", "card", "spend", "shop", "trip"]) {
      expect(writeAt(writes, `stashes/${index}`).updateMask?.fieldPaths).toContain(
        `data.upcomingTransactions.${transactionId}`
      );
      expect(
        writeAt(writes, `stashes/${index}`).updateTransforms?.some((transform) =>
          /historical|completedTransactionCount/u.test(transform.fieldPath)
        ) ?? false
      ).toBe(false);
    }

    expect(writeAt(writes, "stashes/accountsIndex").updateTransforms).toEqual([
      { fieldPath: "data.card.transactionCount", increment: { integerValue: "1" } },
    ]);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  }
);

test("recurring creation shifts a weekend into a periodless month while retaining the monthly anchor", async () => {
  const { service, calls } = fixture();

  const input = {
    accountId: "cash",
    amountMinor: 300,
    categoryId: "spend",
    dueAt: "2030-08-31T10:15:00+08:00",
    frequency: "MONTHLY",
    id: transactionId,
    nonWorkingDayPolicy: "SHIFT_TO_NEXT_AVAILABLE_WORKDAY",
    repeatCount: 6,
    timezone: "Asia/Manila",
  } satisfies TransactionCreate;

  const result = await service.create(input, { dryRun: true });
  expect(result.summary).toMatchObject({
    accounts: [],
    categories: [],
    transaction: {
      after: {
        anchorDay: 31,
        dueAt: "2030-09-02T02:15:00.000Z",
        offsetAdjustment: 2,
        periodId: null,
        repeatCount: 6,
        sequenceCount: 1,
        yearMonth: "2030-09",
      },
    },
  });
  const writes = writesFrom(result);
  expect(writes.some((write) => write.update?.name.includes("/periods/") === true)).toBe(false);
  expect(
    writes.filter((write) => write.update?.name.includes("/transactions/") === true)
  ).toHaveLength(1);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test.each([null, 0, 12])(
  "recurring creation normalizes repeat limit %s without incrementing the initial sequence",
  async (repeatCount) => {
    const { service } = fixture();

    const input = {
      accountId: "cash",
      amountMinor: 100,
      dueAt: timestamp,
      frequency: "MONTHLY",
      repeatCount,
      type: "INFLOW" as const,
    } satisfies TransactionCreate;

    const result = await service.create(input, { dryRun: true });
    expect(result.summary).toMatchObject({
      accounts: [],
      transaction: {
        after: {
          completed: false,
          repeatCount: repeatCount === 0 ? null : repeatCount,
          sequenceCount: 1,
        },
      },
    });
  }
);

test("an ongoing new series cannot be marked completed without a generated successor", async () => {
  const { service, calls } = fixture();

  const input = {
    accountId: "card",
    amountMinor: 100,
    categoryId: "spend",
    completed: true,
    dueAt: timestamp,
    frequency: "MONTHLY",
  } satisfies TransactionCreate;

  await assert.rejects(
    service.create(input, { dryRun: true }),
    /recurring.*completed|completed.*recurring/iu
  );
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test.each([
  { frequency: "FORTNIGHT" },
  { frequency: "MONTHLY", repeatCount: -1 },
  { frequency: "MONTHLY", repeatCount: 1.5 },
  { frequency: "MONTHLY", repeatCount: Number.MAX_SAFE_INTEGER + 1 },
  { frequency: "MONTHLY", nonWorkingDayPolicy: "HOLIDAYS" },
  { frequency: "ONE_OFF", repeatCount: 3 },
  { nonWorkingDayPolicy: "SHIFT_TO_PREVIOUS_AVAILABLE_WORKDAY" },
])("invalid recurrence creation rules fail before committing: %j", async (rules) => {
  const { service, calls } = fixture();

  const input = {
    accountId: "cash",
    amountMinor: 100,
    categoryId: "spend",
    dueAt: timestamp,
    ...rules,
  };

  await assert.rejects(async () => {
    await service.create(TransactionCreateSchema.parse(input), { dryRun: true });
  });
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test.each([
  {
    adjusted: "2030-09-02T12:00:00.000Z",
    anchor: null,
    dueAt: "2030-08-31T12:00:00Z",
    frequency: "DAILY",
    offset: 2,
    policy: "SHIFT_TO_PREVIOUS_AVAILABLE_WORKDAY",
  },
  {
    adjusted: "2030-08-30T12:00:00.000Z",
    anchor: null,
    dueAt: "2030-08-31T12:00:00Z",
    frequency: "WEEKLY",
    offset: -1,
    policy: "SHIFT_TO_PREVIOUS_AVAILABLE_WORKDAY",
  },
  {
    adjusted: "2030-08-31T12:00:00.000Z",
    anchor: 31,
    dueAt: "2030-08-31T12:00:00Z",
    frequency: "MONTHLY",
    offset: 0,
    policy: "KEEP_ORIGINAL_DATE",
  },
])(
  "new $frequency schedules apply $policy and retain their logical anchor",
  async ({ dueAt, frequency, policy, adjusted, offset, anchor }) => {
    const { service } = fixture();

    const input = {
      accountId: "cash",
      amountMinor: 100,
      categoryId: "spend",
      dueAt,
      frequency,
      nonWorkingDayPolicy: policy,
      timezone: "UTC",
    } satisfies TransactionCreate;

    const result = await service.create(input, { dryRun: true });
    expect(result.summary?.transaction.after).toMatchObject({
      anchorDay: anchor,
      dueAt: adjusted,
      offsetAdjustment: offset,
      periodId: null,
    });
  }
);

test("a workday-adjusted recurrence uses the destination saved period, not the original month", async () => {
  const { service, documents } = fixture();
  documents.set(budgetPath, {
    ...documents.get(budgetPath),
    availablePeriods: { "2030-09": { id: "periodOne" } },
  });

  const input = {
    accountId: "card",
    amountMinor: 100,
    categoryId: "spend",
    dueAt: "2030-08-31T12:00:00Z",
    frequency: "MONTHLY",
    id: transactionId,
    nonWorkingDayPolicy: "SHIFT_TO_NEXT_AVAILABLE_WORKDAY",
    timezone: "UTC",
  } satisfies TransactionCreate;

  const result = await service.create(input, { dryRun: true });
  expect(result.summary).toMatchObject({
    categories: [{ after: { upcomingAmount: 100 }, id: "spend", yearMonth: "2030-09" }],
    transaction: { after: { periodId: "periodOne", yearMonth: "2030-09" } },
  });
  const writes = writesFrom(result);
  expect(writeAt(writes, "periods/periodOne").updateTransforms).toEqual([
    { fieldPath: "balances.spend.upcomingAmount", increment: { integerValue: "100" } },
  ]);
  expect(writeAt(writes, "stashes/periodOne").updateMask?.fieldPaths).toContain(
    `data.upcomingTransactions.${transactionId}`
  );
});

test("a single-payment repeat already due records completed card effects without generating a successor", async () => {
  const { service } = fixture();

  const input = {
    accountId: "card",
    amountMinor: 100,
    categoryId: "spend",
    dueAt: timestamp,
    frequency: "MONTHLY",
    id: transactionId,
    repeatCount: 1,
  } satisfies TransactionCreate;

  const result = await service.create(input, { dryRun: true });
  expect(result.summary).toMatchObject({
    accounts: [{ balanceAmount: { delta: -100 }, id: "card" }],
    transaction: { after: { completed: true, repeatCount: 1, sequenceCount: 1 } },
  });
  const writes = writesFrom(result);
  expect(writeAt(writes, "periods/periodOne").updateTransforms).toEqual([
    { fieldPath: "balances.cardCategory.otherAmount", increment: { integerValue: "100" } },
    { fieldPath: "balances.spend.spentAmount", increment: { integerValue: "100" } },
  ]);
  expect(writeAt(writes, `transactions/${transactionId}`).update?.fields?.version).toEqual({
    integerValue: "1",
  });
  expect(
    writes.filter((write) => write.update?.name.includes("/transactions/") === true)
  ).toHaveLength(1);
});

test("a future single-payment repeat stays upcoming and does not require a saved period", async () => {
  const { service } = fixture();

  const input = {
    accountId: "cash",
    amountMinor: 100,
    dueAt: "2030-01-31T12:00:00Z",
    frequency: "MONTHLY",
    repeatCount: 1,
    type: "INFLOW" as const,
  } satisfies TransactionCreate;

  const result = await service.create(input, { dryRun: true });
  expect(result.summary).toMatchObject({
    accounts: [],
    allocationPeriods: [],
    categories: [],
    transaction: {
      after: { anchorDay: 31, completed: false, periodId: null, repeatCount: 1, sequenceCount: 1 },
    },
  });
});

test("periodless recurring refunds retain their positive signed amount without moving debt or reserves", async () => {
  const { service } = fixture();

  const input = {
    accountId: "card",
    amountMinor: 100,
    categoryId: "spend",
    dueAt: "2030-01-31T12:00:00Z",
    frequency: "MONTHLY",
    id: transactionId,
    type: "REFUND" as const,
  } satisfies TransactionCreate;

  const result = await service.create(input, { dryRun: true });
  expect(result.summary).toMatchObject({
    accounts: [],
    categories: [],
    transaction: {
      after: {
        amount: 100,
        completed: false,
        subType: "REFUND",
        type: "OUTFLOW",
      },
    },
  });
  expect(
    writeAt(writesFrom(result), `transactions/${transactionId}`).update?.fields
      ?.autoAllocateIfCapable
  ).toEqual({ booleanValue: false });
});

test("invalid recurrence timezones and unsupported linked categories cannot produce a commit", async () => {
  const { service, documents, calls } = fixture();

  const input = {
    accountId: "cash",
    amountMinor: 100,
    categoryId: "spend",
    dueAt: "2030-01-31T12:00:00Z",
    frequency: "MONTHLY",
  } satisfies TransactionCreate;

  await assert.rejects(
    service.create({ ...input, timezone: "invalid/timezone" }, { dryRun: true })
  );
  documents.set(`${budgetPath}/stashes/categoriesIndex`, {
    data: {
      categories: {
        spend: { id: "spend", linkedAccountIds: ["cash"], type: "DEFAULT" },
      },
    },
  });
  await assert.rejects(service.create(input, { dryRun: true }), /linked/u);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("recurring creation commits one canonical entry, its obligations and indexes with a save marker", async () => {
  const { fetcher } = fixture();
  const requests: Data[] = [];

  const boundary: Fetcher = async (input, init) => {
    const request = new Request(input, init);

    if (request.method === "GET") {
      return await fetcher(input, init);
    }

    assert.equal(new URL(request.url).pathname.endsWith("/documents:commit"), true);
    requests.push(z.object({ writes: z.array(z.unknown()) }).parse(await request.json()));

    return Response.json({ commitTime: timestamp });
  };

  const service = new TransactionService(
    new BeyondClient(structuredClone(session), { fetcher: boundary })
  );

  const input = {
    accountId: "card",
    amountMinor: 300,
    categoryId: "spend",
    dueAt: timestamp,
    frequency: "MONTHLY",
    id: transactionId,
  } satisfies TransactionCreate;

  const result = await service.create(input, { requestId: transactionId });
  expect(result).toMatchObject({ committed: true, transactionId });
  expect(requests).toHaveLength(1);

  const body = z
    .object({
      writes: z.array(
        z.looseObject({
          update: z.object({
            fields: z.record(z.string(), z.unknown()).optional(),
            name: z.string(),
          }),
        })
      ),
    })
    .parse(requests[0]);

  const canonical = body.writes.find(
    (write) => write.update.name === `${budgetPath}/transactions/${transactionId}`
  );

  expect(canonical).toMatchObject({
    currentDocument: { exists: false },
    update: {
      fields: {
        completed: { booleanValue: false },
        frequency: { stringValue: "MONTHLY" },
        sequenceCount: { integerValue: "1" },
      },
    },
  });

  const period = body.writes.find(
    (write) => write.update.name === `${budgetPath}/periods/periodOne`
  );

  expect(period).toMatchObject({
    updateTransforms: [
      { fieldPath: "balances.spend.upcomingAmount", increment: { integerValue: "300" } },
    ],
  });
  expect(
    body.writes.some((write) => write.update.name === `${budgetPath}/saveMarkers/${transactionId}`)
  ).toBe(true);

  for (const id of ["transactionsIndex", "periodOne", "card", "spend"]) {
    expect(body.writes.some((write) => write.update.name === `${budgetPath}/stashes/${id}`)).toBe(
      true
    );
  }
});

test("CLI create accepts recurrence JSON and previews a periodless first occurrence", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-recurring-create-cli-"));
  const previous = process.env.BEBU_SESSION_FILE;
  const { fetcher, calls } = fixture();

  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fetcher, { preconnect: fetch.preconnect })
  );

  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    await writeFile(process.env.BEBU_SESSION_FILE, JSON.stringify(session));
    const file = nodePath.join(directory, "recurring.json");
    await writeFile(
      file,
      JSON.stringify({
        accountId: "card",
        amountMinor: 100,
        categoryId: "spend",
        dueAt: "2030-01-31T12:00:00+08:00",
        frequency: "MONTHLY",
        repeatCount: 6,
        timezone: "Asia/Manila",
      })
    );

    const result = await captureExecute(createApp(), [
      "transactions",
      "create",
      "--file",
      file,
      "--dry-run",
      "--full",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      dryRun: true,
      summary: {
        accounts: [],
        transaction: {
          after: {
            anchorDay: 31,
            frequency: "MONTHLY",
            periodId: null,
            repeatCount: 6,
            sequenceCount: 1,
          },
        },
      },
    });
    expect(JSON.parse(result.stdout)).toHaveProperty("body.writes", expect.any(Array));
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

test("completed single-payment recurrence still requires its historical budget period", async () => {
  const { service, documents, calls } = fixture();
  documents.set(budgetPath, { ...documents.get(budgetPath), availablePeriods: {} });
  await assert.rejects(
    service.create(
      {
        accountId: "card",
        amountMinor: 100,
        categoryId: "spend",
        dueAt: timestamp,
        frequency: "MONTHLY",
        repeatCount: 1,
      },
      { dryRun: true }
    ),
    /period/u
  );
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});
