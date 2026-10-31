/* oxlint-disable func-style -- Named fixture functions keep setup and assertions readable. */
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
import { DataSchema, DocumentRoot, encodeFields } from "../firestore/encoding.ts";
import type { CommitResult, Data, Write } from "../firestore/encoding.ts";
import { TransactionSchema } from "./transaction-model.ts";
import type { Transaction } from "./transaction-model.ts";
import { TransactionService } from "./transactions.ts";

const BudgetPath = `${DocumentRoot}/budgets/deletions`;
const Timestamp = "2026-10-01T12:00:00.000Z";

function occurrence(id: string, fields: Partial<Transaction> = {}): Transaction {
  return TransactionSchema.parse({
    amount: -250,
    autoAllocateIfCapable: true,
    autoAllocateIfIncome: false,
    budgetId: "deletions",
    cleared: true,
    clonedToTransactionId: null,
    color: "NONE",
    completed: true,
    createdAt: Timestamp,
    createdBy: { displayName: "Fixture", email: null, photoUrl: "", uid: "actor" },
    dueAt: Timestamp,
    editable: true,
    eventId: "reused-event",
    externalId: null,
    extraTarget: null,
    extras: {},
    files: [],
    frequency: "MONTHLY",
    id,
    integrityCount: 1,
    latitude: null,
    longitude: null,
    nonWorkingDayPolicy: "KEEP_ORIGINAL_DATE",
    notes: "Service A",
    occurrenceChange: null,
    offsetAdjustment: 0,
    payee: { id: "payee", linkedObjectId: null, linkedObjectType: null, type: "PAYEE" },
    periodId: "october",
    reconciled: false,
    reconciledAt: null,
    reminderDescription: null,
    reminderEnabled: false,
    reminderName: null,
    repeatCount: null,
    sentiment: "NONE",
    sequenceCount: 2,
    siblingTransactionId: null,
    splitId: null,
    subType: null,
    tagIds: ["tag"],
    targetFrom: {
      id: "card",
      linkedObjectId: "reserve",
      linkedObjectType: "CATEGORY",
      type: "CREDIT_CARD",
    },
    targetTo: { id: "spend", linkedObjectId: null, linkedObjectType: null, type: "CATEGORY" },
    timezone: "UTC",
    type: "OUTFLOW",
    version: 1,
    yearMonth: "2026-10",
    ...fields,
  });
}

interface Backend {
  beforeCommit?: () => void;
}

function fixture() {
  const earlier = occurrence("earlier", {
    clonedToTransactionId: "obsolete",
    dueAt: "2026-09-01T12:00:00Z",
    periodId: "september",
    sequenceCount: 1,
    yearMonth: "2026-09",
  });

  const selected = occurrence("obsolete", { clonedToTransactionId: "upcoming" });

  const upcoming = occurrence("upcoming", {
    completed: false,
    dueAt: "2026-11-01T12:00:00Z",
    periodId: "november",
    sequenceCount: 3,
    version: null,
    yearMonth: "2026-11",
  });

  const unrelated = occurrence("valid-service", {
    notes: "Different valid service",
    targetTo: { id: "other", linkedObjectId: null, linkedObjectType: null, type: "CATEGORY" },
  });

  const documents = new Map<string, Data>([
    [
      BudgetPath,
      {
        availablePeriods: {
          "2026-09": { id: "september" },
          "2026-10": { id: "october" },
          "2026-11": { id: "november" },
        },
        stashIdentifiers: {
          ACCOUNTS: "accounts",
          GROUPS_AND_CATEGORIES: "categories",
          PAYEES: "payees",
          TAGS: "tags",
          TRANSACTIONS: "transactions",
        },
        type: "ZERO_BASED",
      },
    ],
    [`${DocumentRoot}/users/actor`, { config: { currencyCode: "PHP", timezone: "UTC" } }],
    [
      `${BudgetPath}/stashes/accounts`,
      {
        data: {
          card: {
            balanceAmount: -500,
            id: "card",
            name: "Card",
            transactionCount: 3,
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
            other: { id: "other", type: "DEFAULT" },
            reserve: { id: "reserve", linkedAccountIds: ["card"], type: "CREDIT_CARD_PAYMENT" },
            spend: { id: "spend", transactionCount: 3, type: "DEFAULT" },
          },
        },
      },
    ],
    [`${BudgetPath}/stashes/payees`, { data: { payee: { id: "payee", transactionCount: 3 } } }],
    [`${BudgetPath}/stashes/tags`, { data: { tag: { id: "tag", transactionCount: 3 } } }],
    [
      `${BudgetPath}/periods/september`,
      { balances: { reserve: { otherAmount: 250 }, spend: { spentAmount: 250 } } },
    ],
    [
      `${BudgetPath}/periods/october`,
      { balances: { reserve: { otherAmount: 250 }, spend: { spentAmount: 250 } } },
    ],
    [`${BudgetPath}/periods/november`, { balances: { spend: { upcomingAmount: 250 } } }],
  ]);

  for (const transaction of [earlier, selected, upcoming, unrelated]) {
    documents.set(`${BudgetPath}/transactions/${transaction.id}`, transaction);
  }

  for (const id of [
    "transactions",
    "september",
    "october",
    "november",
    "card",
    "spend",
    "payee",
    "tag",
  ]) {
    documents.set(`${BudgetPath}/stashes/${id}`, {
      data: {
        completedTransactionCount: 2,
        completedTransactions: { earlier: { amount: -250 }, obsolete: { amount: -250 } },
        historicalBalances: { "2026-09": -250, "2026-10": -250 },
        historicalSpending: { "2026-09": 250, "2026-10": 250 },
        upcomingTransactions: { upcoming: { amount: -250 } },
      },
    });
  }

  const requests: { path: string; body: Data; method: string }[] = [];
  const backend: Backend = {};
  let snapshot = new Map<string, Data>();
  const reads = new Set<string>();
  const queries: { field: string; value: string; names: string[] }[] = [];

  const matching = (source: Map<string, Data>, field: string, value: string) =>
    [...source].filter(
      ([name, data]) => name.startsWith(`${BudgetPath}/transactions/`) && data[field] === value
    );

  const wire = (name: string, data: Data) => ({
    fields: encodeFields(data),
    name,
    updateTime: Timestamp,
  });

  const session: Session = {
    budgetIds: ["deletions"],
    expiresAt: Date.now() + 3_600_000,
    idToken: "fixture",
    importedAt: Timestamp,
    projectId: "beyond-budget",
    stashes: [],
    uid: "actor",
    version: 1,
  };

  const fetcher: Fetcher = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname.slice(4);

    const body =
      request.method === "POST" ? DataSchema.parse(JSON.parse(await request.text())) : {};

    requests.push({ body, method: request.method, path });

    if (path.endsWith(":beginTransaction")) {
      snapshot = structuredClone(documents);

      return Response.json({ transaction: "snapshot" });
    }

    if (path.endsWith(":rollback")) {
      return Response.json({});
    }

    if (path.endsWith(":batchGet")) {
      const names = z.array(z.string()).parse(body.documents);

      return Response.json(
        names.map((name) => {
          reads.add(name);
          const data = snapshot.get(name);

          return data === undefined ? { missing: name } : { found: wire(name, data) };
        })
      );
    }

    if (path.endsWith(":runQuery")) {
      const query = z
        .object({
          limit: z.number().optional(),
          where: z.object({
            fieldFilter: z.object({
              field: z.object({ fieldPath: z.string() }),
              value: z.object({ stringValue: z.string() }),
            }),
          }),
        })
        .parse(body.structuredQuery);

      const filter = query.where.fieldFilter;
      const matches = matching(snapshot, filter.field.fieldPath, filter.value.stringValue);
      queries.push({
        field: filter.field.fieldPath,
        names: matches.map(([name]) => name),
        value: filter.value.stringValue,
      });

      return Response.json(
        matches
          .slice(0, query.limit ?? matches.length)
          .map(([name, data]) => ({ document: wire(name, data) }))
      );
    }

    if (path.endsWith(":commit")) {
      backend.beforeCommit?.();

      const changedRead = [...reads].some(
        (name) => JSON.stringify(documents.get(name)) !== JSON.stringify(snapshot.get(name))
      );

      const changedQuery = queries.some(
        (query) =>
          JSON.stringify(matching(documents, query.field, query.value).map(([name]) => name)) !==
          JSON.stringify(query.names)
      );

      if (changedRead || changedQuery) {
        return Response.json(
          { error: { message: "Concurrent mutation", status: "ABORTED" } },
          { status: 409 }
        );
      }

      return Response.json({ commitTime: Timestamp, writeResults: [] });
    }

    const data = documents.get(path);

    return data === undefined
      ? Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 })
      : Response.json(wire(path, data));
  };

  const client = new BeyondClient(session, { fetcher });

  return {
    backend,
    client,
    documents,
    earlier,
    fetcher,
    requests,
    selected,
    service: new TransactionService(client),
    session,
    upcoming,
  };
}

function writesFrom(result: CommitResult): Write[] {
  assert.ok("dryRun" in result);

  return result.body.writes;
}

function writeAt(writes: Write[], suffix: string): Write {
  const write = writes.find(
    (entry) => (entry.update?.name ?? entry.delete) === `${BudgetPath}/${suffix}`
  );

  assert.ok(write, `Missing write: ${suffix}`);

  return write;
}

test("selected-and-later deletion follows clone links despite a reused event ID and preserves earlier history", async () => {
  const { service, requests } = fixture();
  const result = await service.delete("obsolete", { dryRun: true, scope: "THIS_AND_LATER" });
  const writes = writesFrom(result);
  expect(writes.filter((write) => write.delete !== undefined).map((write) => write.delete)).toEqual(
    [`${BudgetPath}/transactions/obsolete`, `${BudgetPath}/transactions/upcoming`]
  );
  expect(
    writes.some(
      (write) => (write.update?.name ?? write.delete) === `${BudgetPath}/transactions/earlier`
    )
  ).toBe(false);
  expect(
    writes.some(
      (write) => (write.update?.name ?? write.delete) === `${BudgetPath}/transactions/valid-service`
    )
  ).toBe(false);
  expect(writeAt(writes, "periods/october").updateTransforms).toContainValues([
    { fieldPath: "balances.spend.spentAmount", increment: { integerValue: "-250" } },
    { fieldPath: "balances.reserve.otherAmount", increment: { integerValue: "-250" } },
  ]);
  expect(writeAt(writes, "periods/november").updateTransforms).toEqual([
    { fieldPath: "balances.spend.upcomingAmount", increment: { integerValue: "-250" } },
  ]);
  expect(writeAt(writes, "stashes/accounts").updateTransforms).toContainValues([
    { fieldPath: "data.card.balanceAmount", increment: { integerValue: "250" } },
    { fieldPath: "data.card.transactionCount", increment: { integerValue: "-2" } },
  ]);
  expect(writeAt(writes, "stashes/spend").updateTransforms).toContainEqual({
    fieldPath: "data.historicalSpending.`2026-10`",
    increment: { integerValue: "-250" },
  });
  expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);
});

test("single completed occurrence deletion keeps its already-generated successor and its obligations", async () => {
  const { service, requests } = fixture();
  const result = await service.delete("obsolete", { dryRun: true, scope: "THIS_PAYMENT" });
  const writes = writesFrom(result);
  expect(writes.filter((write) => write.delete !== undefined).map((write) => write.delete)).toEqual(
    [`${BudgetPath}/transactions/obsolete`]
  );
  expect(writes.some((write) => write.update?.name === `${BudgetPath}/periods/november`)).toBe(
    false
  );
  expect(writes.some((write) => write.delete === `${BudgetPath}/transactions/upcoming`)).toBe(
    false
  );
  expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);
});

test("a periodless upcoming recurring deletion removes its indexes and counts without requiring a period", async () => {
  const { service, documents, upcoming } = fixture();
  documents.set(`${BudgetPath}/transactions/upcoming`, { ...upcoming, periodId: null });
  const result = await service.delete("upcoming", { dryRun: true, scope: "THIS_AND_LATER" });
  const writes = writesFrom(result);
  expect(writes.some((write) => write.update?.name.includes("/periods/") === true)).toBe(false);
  expect(writeAt(writes, "stashes/transactions").updateMask?.fieldPaths).toContain(
    "data.upcomingTransactions.upcoming"
  );
  expect(writeAt(writes, "stashes/accounts").updateTransforms).toEqual([
    { fieldPath: "data.card.transactionCount", increment: { integerValue: "-1" } },
  ]);
});

test("an active allocation on any later occurrence rejects the complete deletion plan", async () => {
  const { service, documents, upcoming, requests } = fixture();
  documents.set(`${BudgetPath}/transactions/upcoming`, {
    ...upcoming,
    extras: { autoAllocated: true },
  });
  await assert.rejects(
    service.delete("obsolete", { dryRun: true, scope: "THIS_AND_LATER" }),
    /allocation/u
  );
  expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);
});

test("deletion dry runs report exact removed and preserved records and aggregate every affected month", async () => {
  const { service, documents, upcoming } = fixture();
  documents.set(`${BudgetPath}/transactions/upcoming`, {
    ...upcoming,
    completed: true,
    version: 1,
  });
  const result = await service.delete("obsolete", { dryRun: true, scope: "THIS_AND_LATER" });
  expect(result.summary).toMatchObject({
    accounts: [{ balanceAmount: { after: 0, before: -500, delta: 500 }, id: "card" }],
    deletedTransactions: [
      { amount: -250, id: "obsolete" },
      { amount: -250, id: "upcoming" },
    ],
    deletionScope: "THIS_AND_LATER",
    preservedTransactions: [{ clonedToTransactionId: "obsolete", id: "earlier" }],
  });
  expect(result.summary?.categories.map((category) => [category.id, category.yearMonth])).toEqual([
    ["spend", "2026-10"],
    ["reserve", "2026-10"],
    ["spend", "2026-11"],
    ["reserve", "2026-11"],
  ]);

  for (const id of ["card", "spend", "payee", "tag", "transactions"]) {
    expect(writeAt(writesFrom(result), `stashes/${id}`).updateTransforms).toContainEqual({
      fieldPath: "data.completedTransactionCount",
      increment: { integerValue: "-2" },
    });
  }
});

test("completed refunds reverse their native signed ledger while deleting their future obligation", async () => {
  const { service, documents, selected, upcoming, earlier } = fixture();

  for (const transaction of [earlier, selected, upcoming]) {
    documents.set(`${BudgetPath}/transactions/${transaction.id}`, {
      ...transaction,
      amount: 100,
      subType: "REFUND",
    });
  }

  const writes = writesFrom(
    await service.delete("obsolete", { dryRun: true, scope: "THIS_AND_LATER" })
  );

  expect(writeAt(writes, "periods/october").updateTransforms).toContainValues([
    { fieldPath: "balances.spend.spentAmount", increment: { integerValue: "100" } },
    { fieldPath: "balances.reserve.otherAmount", increment: { integerValue: "100" } },
  ]);
  expect(writeAt(writes, "stashes/accounts").updateTransforms).toContainEqual({
    fieldPath: "data.card.balanceAmount",
    increment: { integerValue: "-100" },
  });
  expect(writeAt(writes, "stashes/spend").updateTransforms).toContainEqual({
    fieldPath: "data.historicalSpending.`2026-10`",
    increment: { integerValue: "100" },
  });
  expect(writeAt(writes, "stashes/payee").updateTransforms).toContainEqual({
    fieldPath: "data.historicalSpending.`2026-10`",
    increment: { integerValue: "-100" },
  });
});

test("uncleared recurring deletion reverses only uncleared account money and category spending history", async () => {
  const { service, documents, selected } = fixture();
  documents.set(`${BudgetPath}/transactions/obsolete`, { ...selected, cleared: false });

  const writes = writesFrom(
    await service.delete("obsolete", { dryRun: true, scope: "THIS_PAYMENT" })
  );

  expect(writeAt(writes, "stashes/accounts").updateTransforms).toContainEqual({
    fieldPath: "data.card.unclearedBalanceAmount",
    increment: { integerValue: "250" },
  });
  expect(
    writeAt(writes, "stashes/accounts").updateTransforms?.some(
      (entry) => entry.fieldPath === "data.card.balanceAmount"
    )
  ).toBe(false);
  expect(
    writeAt(writes, "stashes/card").updateTransforms?.some((entry) =>
      entry.fieldPath.startsWith("data.historicalBalances")
    )
  ).toBe(false);
});

test.each([
  { message: /missing/u, name: "missing successor", patch: { clonedToTransactionId: "missing" } },
  {
    message: /cycle|boundary|predecessors/u,
    name: "self link",
    patch: { clonedToTransactionId: "obsolete" },
  },
])("$name cannot silently truncate selected-and-later deletion", async ({ patch, message }) => {
  const { service, documents, selected, requests } = fixture();
  documents.set(`${BudgetPath}/transactions/obsolete`, { ...selected, ...patch });
  await assert.rejects(
    service.delete("obsolete", { dryRun: true, scope: "THIS_AND_LATER" }),
    message
  );
  expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);
});

test.each([
  { name: "cross-budget identity", patch: { budgetId: "elsewhere" } },
  { name: "different canonical identity", patch: { id: "different-id" } },
  { name: "sequence gap", patch: { sequenceCount: 8 } },
  { name: "non-increasing date", patch: { dueAt: "2026-09-01T12:00:00Z" } },
  { name: "different service notes", patch: { notes: "Different service" } },
  { name: "different frequency", patch: { frequency: "WEEKLY" } },
  { name: "different event marker", patch: { eventId: "different-event" } },
  { name: "different payee", patch: { payee: null } },
  {
    name: "different category",
    patch: {
      targetTo: { id: "other", linkedObjectId: null, linkedObjectType: null, type: "CATEGORY" },
    },
  },
])(
  "a linked $name rejects the entire deletion instead of crossing the boundary",
  async ({ patch }) => {
    const { service, documents, upcoming, requests } = fixture();
    documents.set(`${BudgetPath}/transactions/upcoming`, { ...upcoming, ...patch });
    await assert.rejects(
      service.delete("obsolete", { dryRun: true, scope: "THIS_AND_LATER" }),
      /identity|boundary/u
    );
    expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);
  }
);

test("multiple incoming clone links reject an ambiguous chain", async () => {
  const { service, documents, earlier, requests } = fixture();
  documents.set(`${BudgetPath}/transactions/another-parent`, { ...earlier, id: "another-parent" });
  await assert.rejects(
    service.delete("obsolete", { dryRun: true, scope: "THIS_AND_LATER" }),
    /multiple predecessors/u
  );
  expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);
});

test("an ongoing tail cannot silently stop the series under THIS_PAYMENT", async () => {
  const { service, requests } = fixture();
  await assert.rejects(
    service.delete("upcoming", { dryRun: true, scope: "THIS_PAYMENT" }),
    /without a generated successor/u
  );
  expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);
});

test("the exhausted finite tail permits one-occurrence deletion without generating a replacement", async () => {
  const { service, documents, upcoming } = fixture();
  documents.set(`${BudgetPath}/transactions/upcoming`, { ...upcoming, repeatCount: 3 });

  const writes = writesFrom(
    await service.delete("upcoming", { dryRun: true, scope: "THIS_PAYMENT" })
  );

  expect(writes.filter((write) => write.delete !== undefined).map((write) => write.delete)).toEqual(
    [`${BudgetPath}/transactions/upcoming`]
  );
  expect(
    writes.some((write) => write.update?.name.startsWith(`${BudgetPath}/transactions/`) === true)
  ).toBe(false);
});

test("recurring deletion requires an explicit scope", async () => {
  const { service, requests } = fixture();
  await assert.rejects(service.delete("obsolete", { dryRun: true }), /explicit scope/u);
  expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);
});

test.each([
  { history: true, name: "allocation history", patch: {} },
  { history: false, name: "reconciliation", patch: { reconciled: true } },
  { history: false, name: "files", patch: { files: ["attachment"] } },
  { history: false, name: "split", patch: { splitId: "split" } },
  { history: false, name: "noneditable record", patch: { editable: false } },
])(
  "a later occurrence with $name protects the entire atomic operation",
  async ({ patch, history }) => {
    const { service, documents, upcoming, requests } = fixture();
    documents.set(`${BudgetPath}/transactions/upcoming`, { ...upcoming, ...patch });

    if (history) {
      documents.set(BudgetPath, {
        ...documents.get(BudgetPath),
        allocationHistory: { upcoming: { id: "upcoming" } },
      });
    }

    await assert.rejects(service.delete("obsolete", { dryRun: true, scope: "THIS_AND_LATER" }));
    expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);
  }
);

test("trimmed completed previews still decrement native counts without recreating previews", async () => {
  const { service, documents } = fixture();
  documents.set(`${BudgetPath}/stashes/transactions`, {
    data: { completedTransactionCount: 10, completedTransactions: {} },
  });

  const writes = writesFrom(
    await service.delete("obsolete", { dryRun: true, scope: "THIS_PAYMENT" })
  );

  const index = writeAt(writes, "stashes/transactions");
  expect(index.updateMask?.fieldPaths).toEqual([]);
  expect(index.updateTransforms).toEqual([
    { fieldPath: "data.completedTransactionCount", increment: { integerValue: "-1" } },
  ]);
});

test("dry-run reads and predecessor queries share a read-only snapshot and never commit", async () => {
  const { service, requests } = fixture();
  await service.delete("obsolete", { dryRun: true, scope: "THIS_AND_LATER" });
  expect(requests.find((request) => request.path.endsWith(":beginTransaction"))?.body).toEqual({
    options: { readOnly: {} },
  });

  const reads = requests.filter(
    (request) => request.path.endsWith(":runQuery") || request.path.endsWith(":batchGet")
  );

  expect(reads.length).toBeGreaterThan(0);

  for (const request of reads) {
    expect(request.body.transaction).toBe("snapshot");
  }

  for (const request of requests.filter((entry) => entry.path.endsWith(":runQuery"))) {
    expect(request.body).toMatchObject({
      structuredQuery: {
        where: { fieldFilter: { field: { fieldPath: "clonedToTransactionId" } } },
      },
    });
  }

  expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);
  expect(requests.filter((request) => request.path.endsWith(":rollback"))).toHaveLength(1);
});

test("all linked deletions, reversals, indexes, and one marker commit in a single snapshot transaction", async () => {
  const { service, requests } = fixture();

  const result = await service.delete("obsolete", {
    requestId: "ABCDEFGHIJKLMNOPQRST",
    scope: "THIS_AND_LATER",
  });

  expect(result).toMatchObject({
    committed: true,
    deletedTransactionIds: ["obsolete", "upcoming"],
  });
  const commits = requests.filter((request) => request.path.endsWith(":commit"));
  expect(commits).toHaveLength(1);
  expect(commits[0]?.body.transaction).toBe("snapshot");

  const writes = z
    .array(
      z.object({ delete: z.string().optional(), update: z.object({ name: z.string() }).optional() })
    )
    .parse(commits[0]?.body.writes);

  expect(writes.filter((write) => write.delete !== undefined).map((write) => write.delete)).toEqual(
    [`${BudgetPath}/transactions/obsolete`, `${BudgetPath}/transactions/upcoming`]
  );
  expect(
    writes.some((write) => write.update?.name === `${BudgetPath}/saveMarkers/ABCDEFGHIJKLMNOPQRST`)
  ).toBe(true);

  for (const suffix of [
    "periods/october",
    "periods/november",
    "stashes/accounts",
    "stashes/categories",
    "stashes/transactions",
    "stashes/payees",
    "stashes/tags",
  ]) {
    expect(writes.some((write) => write.update?.name === `${BudgetPath}/${suffix}`)).toBe(true);
  }
});

test.each(["predecessor", "new incoming edge", "allocation history"])(
  "concurrent %s changes abort without partial writes or automatic retry",
  async (change) => {
    const { service, documents, earlier, backend, requests } = fixture();
    backend.beforeCommit = () => {
      if (change === "predecessor") {
        documents.set(`${BudgetPath}/transactions/earlier`, {
          ...earlier,
          notes: "Changed concurrently",
        });
      }

      if (change === "new incoming edge") {
        documents.set(`${BudgetPath}/transactions/new-parent`, { ...earlier, id: "new-parent" });
      }

      if (change === "allocation history") {
        documents.set(BudgetPath, {
          ...documents.get(BudgetPath),
          allocationHistory: { obsolete: { id: "obsolete" } },
        });
      }
    };

    await assert.rejects(service.delete("obsolete", { scope: "THIS_AND_LATER" }), /ABORTED/u);
    expect(requests.filter((request) => request.path.endsWith(":commit"))).toHaveLength(1);
  }
);

test("reminder cleanup removes only selected transaction reminders even when their enabled flag is false", async () => {
  const { service, documents } = fixture();
  const budget = DataSchema.parse(documents.get(BudgetPath));
  documents.set(BudgetPath, {
    ...budget,
    stashIdentifiers: { ...DataSchema.parse(budget.stashIdentifiers), REMINDERS: "reminders" },
  });
  documents.set(`${BudgetPath}/stashes/reminders`, {
    data: {
      earlier: { id: "earlier" },
      obsolete: { id: "obsolete" },
      upcoming: { id: "upcoming" },
    },
  });

  for (const id of ["obsolete", "upcoming", "earlier"]) {
    documents.set(`${BudgetPath}/reminders/${id}`, { id });
  }

  const writes = writesFrom(
    await service.delete("obsolete", { dryRun: true, scope: "THIS_AND_LATER" })
  );

  expect(
    writes
      .filter((write) => write.delete?.includes("/reminders/") === true)
      .map((write) => write.delete)
  ).toEqual([`${BudgetPath}/reminders/obsolete`, `${BudgetPath}/reminders/upcoming`]);
  expect(writeAt(writes, "stashes/reminders").updateMask?.fieldPaths).toEqual([
    "data.obsolete",
    "data.upcoming",
  ]);
});

test("a single already-generated upcoming occurrence is removable while its successor remains scheduled", async () => {
  const { service, documents, upcoming } = fixture();
  documents.set(`${BudgetPath}/transactions/upcoming`, {
    ...upcoming,
    clonedToTransactionId: "later",
  });
  documents.set(`${BudgetPath}/transactions/later`, {
    ...upcoming,
    dueAt: "2026-12-01T12:00:00Z",
    id: "later",
    periodId: null,
    sequenceCount: 4,
    yearMonth: "2026-12",
  });
  const result = await service.delete("upcoming", { dryRun: true, scope: "THIS_PAYMENT" });
  const writes = writesFrom(result);
  expect(result.summary).toMatchObject({
    deletedTransactions: [{ id: "upcoming" }],
    preservedTransactions: [{ id: "obsolete" }, { id: "later" }],
  });
  expect(writes.filter((write) => write.delete !== undefined).map((write) => write.delete)).toEqual(
    [`${BudgetPath}/transactions/upcoming`]
  );
  expect(writeAt(writes, "periods/november").updateTransforms).toEqual([
    { fieldPath: "balances.spend.upcomingAmount", increment: { integerValue: "-250" } },
  ]);
  expect(
    writes.some((write) => write.update?.name.startsWith(`${BudgetPath}/transactions/`) === true)
  ).toBe(false);
});

test("oversized clone chains fail before financial planning or any commit", async () => {
  const { service, documents, requests } = fixture();

  for (let index = 0; index <= 100; index += 1) {
    const date = new Date(Timestamp);
    date.setUTCMonth(date.getUTCMonth() + index);
    const id = index === 0 ? "obsolete" : `chain${index}`;
    documents.set(
      `${BudgetPath}/transactions/${id}`,
      occurrence(id, {
        clonedToTransactionId: index < 100 ? `chain${index + 1}` : null,
        dueAt: date.toISOString(),
        sequenceCount: index + 2,
      })
    );
  }

  await assert.rejects(
    service.delete("obsolete", { dryRun: true, scope: "THIS_AND_LATER" }),
    /inspection limit/u
  );
  expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);
});

test("too many index dependencies cannot split a deletion into partial commits", async () => {
  const { service, documents, selected, upcoming, requests } = fixture();
  const tagIds = Array.from({ length: 490 }, (_, index) => `tag${index}`);
  documents.set(`${BudgetPath}/transactions/obsolete`, { ...selected, tagIds });
  documents.set(`${BudgetPath}/transactions/upcoming`, { ...upcoming, tagIds });
  documents.set(`${BudgetPath}/stashes/tags`, {
    data: Object.fromEntries(tagIds.map((id) => [id, { id, transactionCount: 2 }])),
  });

  for (const id of tagIds) {
    documents.set(`${BudgetPath}/stashes/${id}`, {
      data: {
        completedTransactionCount: 1,
        completedTransactions: { obsolete: {} },
        upcomingTransactions: { upcoming: {} },
      },
    });
  }

  await assert.rejects(
    service.delete("obsolete", { scope: "THIS_AND_LATER" }),
    /atomic write limit/u
  );
  expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);
});

test("CLI deletion requires a valid explicit scope and reports the scoped dry-run result", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-recurring-delete-"));
  const previous = process.env.BEBU_SESSION_FILE;
  const { fetcher, session, requests } = fixture();

  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fetcher, { preconnect: fetch.preconnect })
  );

  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    await writeFile(process.env.BEBU_SESSION_FILE, JSON.stringify(session));

    const result = await captureExecute(createApp(), [
      "transactions",
      "delete",
      "obsolete",
      "--scope",
      "THIS_AND_LATER",
      "--dry-run",
      "--full",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      deletedTransactionIds: ["obsolete", "upcoming"],
      dryRun: true,
      summary: {
        deletedTransactions: [{ id: "obsolete" }, { id: "upcoming" }],
        preservedTransactions: [{ id: "earlier" }],
      },
    });

    const invalid = await captureExecute(createApp(), [
      "transactions",
      "delete",
      "obsolete",
      "--scope",
      "ALL_MATCHING_EVENTS",
      "--dry-run",
    ]);

    expect(invalid.exitCode).toBe(1);
    expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);
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
