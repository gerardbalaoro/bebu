/* oxlint-disable func-style -- Named fixtures exercise real category planning and transport boundaries. */
import { afterAll, expect, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { captureExecute } from "@crustjs/testing";
import { z } from "zod";

import { createApp } from "../cli/app.ts";
import { BeyondClient } from "../firestore/client.ts";
import type { Fetcher } from "../firestore/client.ts";
import { DataSchema, DocumentRoot, encodeFields, decode } from "../firestore/encoding.ts";
import type { Data, Write } from "../firestore/encoding.ts";
import { TransactionOperations } from "./transaction-operations.ts";
import { ExpenseCategoryService } from "./transaction-reclassify.ts";

const Home = await mkdtemp(nodePath.join(tmpdir(), "bebu-reclassification-tests-"));

afterAll(async () => {
  await rm(Home, { force: true, recursive: true });
});

const Budget = `${DocumentRoot}/budgets/categoryLab`;
const Time = "2026-11-02T00:00:00Z";
const Id = "CategoryExpense00001";

function fixture() {
  const source = {
    id: "bank",
    linkedObjectId: "fund",
    linkedObjectType: "CATEGORY",
    type: "GENERIC_ACCOUNT",
  };

  const category = {
    archived: false,
    deleted: false,
    linkedAccountIds: [],
    modifiable: true,
    transactionCount: 1,
    type: "DEFAULT",
  };

  const transaction: Data = {
    amount: -250,
    autoAllocateIfCapable: true,
    budgetId: "categoryLab",
    cleared: true,
    clonedToTransactionId: null,
    completed: true,
    createdBy: { displayName: "Test", email: null, photoUrl: "", uid: "testActor" },
    dueAt: "2026-10-03T01:02:03Z",
    editable: true,
    extraTarget: null,
    extras: {},
    files: [],
    frequency: "ONE_OFF",
    id: Id,
    payee: null,
    periodId: "october",
    reconciled: false,
    reconciledAt: null,
    siblingTransactionId: null,
    splitId: null,
    subType: null,
    tagIds: [],
    targetFrom: source,
    targetTo: { id: "old", linkedObjectId: null, linkedObjectType: null, type: "CATEGORY" },
    timezone: "UTC",
    type: "OUTFLOW",
    unknown: { retain: "exactly" },
    version: 1,
    yearMonth: "2026-10",
  };

  const preview = {
    amount: -250,
    autoAllocateIfIncome: true,
    cleared: true,
    completed: true,
    createdByUserId: "testActor",
    dueAt: new Date("2026-10-03T01:02:03Z"),
    id: Id,
    reconciled: false,
    reconciledAt: null,
    targetFromId: "bank",
    targetToId: "old",
    type: "OUTFLOW",
    unknown: { retain: "preview" },
  };

  const stash = (id: string, count: number, spending: number) => ({
    data: {
      completedTransactionCount: count,
      completedTransactions: count ? { [Id]: preview } : {},
      historicalAllocations: { "2026-10": 900 },
      historicalSpending: { "2026-10": spending },
    },
    id,
    type: "CATEGORY",
  });

  const docs = new Map<string, Data>([
    [`${DocumentRoot}/users/testActor`, { config: { currencyCode: "PHP", timezone: "UTC" } }],
    [
      Budget,
      {
        availablePeriods: { "2026-10": { id: "october" }, "2026-11": { id: "november" } },
        id: "categoryLab",
        stashIdentifiers: {
          ACCOUNTS: "accounts",
          GROUPS_AND_CATEGORIES: "categories",
          TRANSACTIONS: "transactions",
        },
        type: "ZERO_BASED",
      },
    ],
    [
      `${Budget}/stashes/accounts`,
      {
        data: {
          bank: {
            balanceAmount: 9750,
            currencyCode: "PHP",
            id: "bank",
            linkedCategoryId: "fund",
            type: "SAVINGS",
            unclearedBalanceAmount: 0,
          },
        },
        id: "accounts",
        type: "ACCOUNTS",
      },
    ],
    [
      `${Budget}/stashes/categories`,
      {
        data: {
          categories: {
            fund: { ...category, id: "fund", linkedAccountIds: ["bank"] },
            next: { ...category, id: "next", transactionCount: 0 },
            old: { ...category, id: "old" },
          },
        },
      },
    ],
    [`${Budget}/transactions/${Id}`, transaction],
    [
      `${Budget}/periods/october`,
      {
        balances: {
          next: { carriedOverAmount: 77, spentAmount: 0 },
          old: { allocatedAmount: 500, spentAmount: 250 },
        },
        id: "october",
        yearMonth: "2026-10",
      },
    ],
    [
      `${Budget}/periods/november`,
      {
        balances: { next: { carriedOverAmount: 77 }, old: { carriedOverAmount: 250 } },
        id: "november",
        yearMonth: "2026-11",
      },
    ],
    [`${Budget}/stashes/old`, stash("old", 1, 250)],
    [`${Budget}/stashes/next`, stash("next", 0, 0)],
    [
      `${Budget}/stashes/transactions`,
      {
        data: { completedTransactionCount: 1, completedTransactions: { [Id]: preview } },
        id: "transactions",
        type: "TRANSACTIONS",
      },
    ],
    [
      `${Budget}/stashes/bank`,
      {
        data: {
          completedTransactionCount: 1,
          completedTransactions: {},
          historicalBalances: { "2026-10": -250 },
        },
        id: "bank",
        type: "ACCOUNT",
      },
    ],
    [
      `${Budget}/stashes/october`,
      {
        data: { completedTransactionCount: 1, completedTransactions: {} },
        id: "october",
        type: "TRANSACTIONS",
      },
    ],
  ]);

  const requests: { path: string; body: Data }[] = [];
  let commitOutcome = "complete";

  const fetcher: Fetcher = async (input, init) => {
    const path = new URL(new Request(input).url).pathname.slice(4);

    const body =
      init?.body !== undefined && init.body !== null
        ? DataSchema.parse(await new Response(init.body).json())
        : {};

    requests.push({ body, path });

    if (path.endsWith(":beginTransaction")) {
      return Response.json({ transaction: "consistent-category-snapshot" });
    }

    if (path.endsWith(":rollback")) {
      return Response.json({});
    }

    if (path.includes("/saveMarkers/")) {
      return Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 });
    }

    if (init?.method === "GET") {
      const data = docs.get(path);

      if (data !== undefined) {
        return Response.json({ fields: encodeFields(data), name: path, updateTime: Time });
      }
    }

    if (path.endsWith(":batchGet")) {
      return Response.json(
        z
          .array(z.string())
          .parse(body.documents)
          .map((name) => {
            const data = docs.get(name);

            if (data === undefined) {
              return { missing: name };
            }

            const fields = encodeFields(data);

            if (name.includes("/transactions/") && z.string().safeParse(data.dueAt).success) {
              fields.dueAt = { timestampValue: z.string().parse(data.dueAt) };
            }

            return {
              found: {
                fields: DataSchema.parse(
                  JSON.parse(
                    JSON.stringify(fields).replaceAll('"mapValue":{"fields":{}}', '"mapValue":{}')
                  )
                ),
                name,
                updateTime: Time,
              },
            };
          })
      );
    }

    if (path.endsWith(":runQuery")) {
      const query = DataSchema.parse(body.structuredQuery);
      const filter = DataSchema.parse(DataSchema.parse(query.where).fieldFilter);
      expect(DataSchema.parse(filter.field).fieldPath).toBe("splitId");
      const splitId = DataSchema.parse(filter.value).stringValue;

      return Response.json(
        [...docs]
          .filter(([name, data]) => name.includes("/transactions/") && data.splitId === splitId)
          .slice(0, z.number().parse(query.limit))
          .map(([name, data]) => ({
            document: { fields: encodeFields(data), name, updateTime: Time },
          }))
      );
    }

    if (path.endsWith(":commit")) {
      if (commitOutcome === "lost") {
        throw new Error("Lost original acknowledgment");
      }

      if (commitOutcome === "conflict") {
        return Response.json({ error: { status: "ABORTED" } }, { status: 409 });
      }

      return Response.json({
        commitTime: Time,
        writeResults: z
          .array(z.unknown())
          .parse(body.writes)
          .slice(0, commitOutcome === "short" ? 1 : undefined)
          .map(() => ({ updateTime: Time })),
      });
    }

    throw new Error(`Unexpected request ${path}`);
  };

  const client = new BeyondClient(
    {
      budgetIds: ["categoryLab"],
      expiresAt: Date.now() + 3_600_000,
      idToken: "synthetic",
      importedAt: Time,
      projectId: "beyond-budget",
      stashes: [],
      uid: "testActor",
      version: 1,
    },
    { budget: "categoryLab", fetcher }
  );

  return {
    client,
    docs,
    fail: (outcome: string) => {
      commitOutcome = outcome;
    },
    fetcher,
    preview,
    requests,
    service: new ExpenseCategoryService(client, { home: Home }),
    transaction,
  };
}

test("a historical category move preserves an omitted income flag instead of rebuilding its model", async () => {
  const { service, requests, transaction } = fixture();

  const result = await service.reclassify(
    Id,
    { categoryId: "next", fromCategoryId: "old" },
    { dryRun: true }
  );

  expect(result).toMatchObject({
    executionSupported: true,
    summary: { accountBalanceChanges: [], fundingChanges: [], propagationVerified: false },
  });
  assert.ok("body" in result);
  const { writes } = result.body;
  const canonical = writes.find((w: Write) => w.update?.name === `${Budget}/transactions/${Id}`);
  expect(canonical?.updateMask?.fieldPaths).toEqual(["targetTo.id"]);
  expect(canonical?.update?.fields).toEqual({
    targetTo: { mapValue: { fields: { id: { stringValue: "next" } } } },
  });
  expect(transaction).not.toHaveProperty("autoAllocateIfIncome");
  expect(writes.some((w: Write) => w.update?.name === `${Budget}/stashes/accounts`)).toBe(false);
  expect(writes.some((w: Write) => w.update?.name === `${Budget}/periods/november`)).toBe(false);
  const period = writes.find((w: Write) => w.update?.name === `${Budget}/periods/october`);
  expect(period?.updateTransforms).toEqual([
    { fieldPath: "balances.old.spentAmount", increment: { integerValue: "-250" } },
    { fieldPath: "balances.next.spentAmount", increment: { integerValue: "250" } },
  ]);
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test.each([2, 3])(
  "reclassifying one member of a complete %i-member split preserves every sibling and total",
  async (size) => {
    const { service, transaction, preview, docs } = fixture();
    transaction.splitId = "KnownSplit";
    Object.assign(preview, { splitId: "KnownSplit" });
    const entries: Record<string, Data> = {};

    for (let n = 1; n < size; n += 1) {
      const id = `Sibling${n}`;
      docs.set(`${Budget}/transactions/${id}`, {
        ...structuredClone(transaction),
        amount: -100,
        id,
        targetTo: { id: "next", linkedObjectId: null, linkedObjectType: null, type: "CATEGORY" },
      });
      entries[id] = { ...structuredClone(preview), amount: -100, id, targetToId: "next" };
    }

    const next = docs.get(`${Budget}/stashes/next`);
    assert.ok(next);
    next.data = {
      ...DataSchema.parse(next.data),
      completedTransactionCount: size - 1,
      completedTransactions: entries,
      historicalSpending: { "2026-10": 100 * (size - 1) },
    };
    const index = docs.get(`${Budget}/stashes/categories`);
    assert.ok(index);
    const categories = DataSchema.parse(DataSchema.parse(index.data).categories);
    index.data = {
      categories: {
        ...categories,
        next: { ...DataSchema.parse(categories.next), transactionCount: size - 1 },
      },
    };

    const result = await service.reclassify(
      Id,
      { categoryId: "next", fromCategoryId: "old" },
      { dryRun: true }
    );

    assert.ok("body" in result);
    expect(result.summary.splitMembers).toHaveLength(size);
    expect(
      result.body.writes.filter((w) => w.update?.name?.includes("/transactions/") === true)
    ).toHaveLength(1);
    expect(
      result.body.writes.find((w) => w.update?.name === `${Budget}/transactions/${Id}`)?.updateMask
        ?.fieldPaths
    ).toEqual(["targetTo.id"]);

    for (let n = 1; n < size; n += 1) {
      expect(docs.get(`${Budget}/transactions/Sibling${n}`)?.amount).toBe(-100);
    }
  }
);

test("an editable imported card refund moves signed spending without changing its reserve or editability", async () => {
  const { service, transaction, preview, docs } = fixture();
  transaction.amount = 250;
  transaction.subType = "REFUND";
  transaction.targetFrom = {
    id: "bank",
    linkedObjectId: "fund",
    linkedObjectType: "CATEGORY",
    type: "CREDIT_CARD",
  };
  preview.amount = 250;
  const accountDoc = docs.get(`${Budget}/stashes/accounts`);
  assert.ok(accountDoc);
  accountDoc.data = {
    bank: { ...DataSchema.parse(DataSchema.parse(accountDoc.data).bank), type: "CREDIT_CARD" },
  };
  const period = docs.get(`${Budget}/periods/october`);
  assert.ok(period);
  period.balances = {
    fund: { otherAmount: 750 },
    next: { spentAmount: 1000 },
    old: { spentAmount: -250 },
  };
  const stash = docs.get(`${Budget}/stashes/old`);
  assert.ok(stash);
  stash.data = { ...DataSchema.parse(stash.data), historicalSpending: { "2026-10": -250 } };

  const result = await service.reclassify(
    Id,
    { categoryId: "next", fromCategoryId: "old" },
    { dryRun: true }
  );

  assert.ok("body" in result);

  const changes = result.body.writes.find(
    (w) => w.update?.name === `${Budget}/periods/october`
  )?.updateTransforms;

  expect(changes).toEqual([
    { fieldPath: "balances.old.spentAmount", increment: { integerValue: "250" } },
    { fieldPath: "balances.next.spentAmount", increment: { integerValue: "-250" } },
  ]);

  const canonical = result.body.writes.find(
    (w) => w.update?.name === `${Budget}/transactions/${Id}`
  );

  expect(canonical?.updateMask?.fieldPaths).toEqual(["targetTo.id"]);
  expect(JSON.stringify(result.body.writes)).not.toContain("otherAmount");
});

test.each(["GENERIC_ACCOUNT", "CREDIT_CARD"])(
  "category-only attribution preserves a read-only %s refund's financial lock",
  async (kind) => {
    const { service, transaction, preview, docs } = fixture();
    transaction.amount = 250;
    transaction.subType = "REFUND";
    transaction.editable = false;
    transaction.targetFrom = {
      id: "bank",
      linkedObjectId: "fund",
      linkedObjectType: "CATEGORY",
      type: kind,
    };
    preview.amount = 250;

    const accounts = docs.get(`${Budget}/stashes/accounts`);
    assert.ok(accounts);

    const data = DataSchema.parse(accounts.data);

    accounts.data = {
      ...data,
      bank: {
        ...DataSchema.parse(data.bank),
        type: kind === "CREDIT_CARD" ? "CREDIT_CARD" : "SAVINGS",
      },
    };

    const result = await service.reclassify(
      Id,
      { categoryId: "next", fromCategoryId: "old" },
      { dryRun: true }
    );

    assert.ok("body" in result);

    const canonical = result.body.writes.find(
      (w) => w.update?.name === `${Budget}/transactions/${Id}`
    );

    expect(canonical?.updateMask?.fieldPaths).toEqual(["targetTo.id"]);
    expect(canonical?.update?.fields).not.toHaveProperty("editable");
    expect(canonical?.update?.fields).not.toHaveProperty("amount");
    expect(result.body.writes.some((w) => w.update?.name === `${Budget}/stashes/accounts`)).toBe(
      false
    );
  }
);

test("a stale preview date is corrected from the unchanged canonical timestamp", async () => {
  const { service, preview } = fixture();
  preview.dueAt = new Date("2026-10-03T05:06:07Z");

  const result = await service.reclassify(
    Id,
    { categoryId: "next", fromCategoryId: "old" },
    { dryRun: true }
  );

  assert.ok("body" in result);
  expect(result.summary.correctedPreviewFields).toContain("dueAt");
  const destination = result.body.writes.find((w) => w.update?.name === `${Budget}/stashes/next`);
  assert.ok(destination?.update?.fields);

  const entry = DataSchema.parse(
    DataSchema.parse(decode(destination.update.fields.data)).completedTransactions
  )[Id];

  expect(DataSchema.parse(entry).dueAt).toBe("2026-10-03T01:02:03Z");
  expect(
    result.body.writes.find((w) => w.update?.name === `${Budget}/stashes/transactions`)?.updateMask
      ?.fieldPaths
  ).toContain(`data.completedTransactions.${Id}.dueAt`);
  expect(
    result.body.writes.find((w) => w.update?.name === `${Budget}/transactions/${Id}`)?.updateMask
      ?.fieldPaths
  ).toEqual(["targetTo.id"]);
});

test("CLI reclassify requires explicit budget and source-category intent", async () => {
  const result = await captureExecute(createApp(), [
    "transactions",
    "reclassify",
    Id,
    "--category",
    "next",
    "--dry-run",
  ]);

  expect(result.exitCode).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("budget");
});

test("CLI reclassify routes its expected source and emits the reviewed atomic body", async () => {
  const { client, fetcher, requests } = fixture();
  const home = await mkdtemp(nodePath.join(tmpdir(), "bebu-reclassify-cli-"));
  const previousHome = process.env.BEBU_HOME;
  const previousSession = process.env.BEBU_SESSION_FILE;
  process.env.BEBU_HOME = home;
  process.env.BEBU_SESSION_FILE = nodePath.join(home, "session.json");

  const mock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fetcher, { preconnect: fetch.preconnect })
  );

  try {
    await writeFile(process.env.BEBU_SESSION_FILE, JSON.stringify(client.session));

    const result = await captureExecute(createApp(), [
      "transactions",
      "reclassify",
      Id,
      "--budget",
      "categoryLab",
      "--from-category",
      "old",
      "--category",
      "next",
      "--dry-run",
      "--full",
      "--compact",
    ]);

    expect(result.exitCode, result.stdout + result.stderr).toBe(0);

    const parsed = z
      .object({
        body: z.object({ writes: z.array(DataSchema) }),
        dryRun: z.literal(true),
        summary: z.object({ categoryId: z.string(), fromCategoryId: z.string() }),
      })
      .parse(JSON.parse(result.stdout));

    expect(parsed.summary).toEqual({ categoryId: "next", fromCategoryId: "old" });
    expect(
      parsed.body.writes.some(
        (w) => DataSchema.parse(w.update).name === `${Budget}/transactions/${Id}`
      )
    ).toBe(true);
    expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
  } finally {
    mock.mockRestore();

    if (previousHome === undefined) {
      delete process.env.BEBU_HOME;
    } else {
      process.env.BEBU_HOME = previousHome;
    }

    if (previousSession === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previousSession;
    }

    await rm(home, { force: true, recursive: true });
  }
});

test("moving the stored preview preserves native timestamps and unknown preview fields", async () => {
  const { service } = fixture();

  const result = await service.reclassify(
    Id,
    { categoryId: "next", fromCategoryId: "old" },
    { dryRun: true }
  );

  assert.ok("body" in result);
  const write = result.body.writes.find((w: Write) => w.update?.name === `${Budget}/stashes/next`);
  assert.ok(write?.update?.fields);
  const data = DataSchema.parse(decode(write.update.fields.data));
  const preview = DataSchema.parse(data.completedTransactions)[Id];
  expect(preview).toMatchObject({
    autoAllocateIfIncome: true,
    dueAt: "2026-10-03T01:02:03.000Z",
    targetToId: "next",
    unknown: { retain: "preview" },
  });
  expect(write.updateTransforms).toContainEqual({
    fieldPath: "data.historicalSpending.`2026-10`",
    increment: { integerValue: "250" },
  });
});

test.each([
  ["immutable expense", { editable: false }],
  ["negative refund", { amount: -250, subType: "REFUND" }],
  ["split", { splitId: "another" }],
  ["allocation extras", { extras: { autoAllocated: true } }],
] as const)("category reassignment rejects %s before dispatch", async (_name, patch) => {
  const { service, transaction, requests } = fixture();
  Object.assign(transaction, patch);
  await assert.rejects(
    service.reclassify(Id, { categoryId: "next", fromCategoryId: "old" }, { dryRun: true })
  );
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test("category-only writes retain legacy version, creator, allocation and reconciliation fields without consuming defaults", async () => {
  const { service, transaction, preview, docs } = fixture();
  delete transaction.version;
  delete transaction.autoAllocateIfCapable;
  transaction.createdBy = null;
  transaction.reconciled = true;
  transaction.reconciledAt = "2026-10-04T00:00:00Z";
  Object.assign(preview, { reconciled: true, reconciledAt: new Date("2026-10-04T00:00:00Z") });

  const index = DataSchema.parse(
    DataSchema.parse(docs.get(`${Budget}/stashes/categories`)?.data).categories
  );

  const oldCategory = DataSchema.parse(index.old);
  delete oldCategory.linkedAccountIds;
  const categoryDoc = docs.get(`${Budget}/stashes/categories`);
  assert.ok(categoryDoc);
  categoryDoc.data = { categories: { ...index, old: oldCategory } };

  const result = await service.reclassify(
    Id,
    { categoryId: "next", fromCategoryId: "old" },
    { dryRun: true }
  );

  assert.ok("body" in result);

  const canonical = result.body.writes.find(
    (write) => write.update?.name === `${Budget}/transactions/${Id}`
  );

  expect(canonical?.updateMask?.fieldPaths).toEqual(["targetTo.id"]);
  expect(canonical?.update?.fields).not.toHaveProperty("version");
  expect(canonical?.update?.fields).not.toHaveProperty("autoAllocateIfCapable");
  expect(canonical?.update?.fields).not.toHaveProperty("createdBy");
  expect(canonical?.update?.fields).not.toHaveProperty("reconciledAt");
});

test("an omitted destination link list stays omitted when the writer never resolves account links", async () => {
  const { service, docs } = fixture();
  const index = docs.get(`${Budget}/stashes/categories`);
  assert.ok(index);
  const categories = DataSchema.parse(DataSchema.parse(index.data).categories);
  const next = DataSchema.parse(categories.next);
  delete next.linkedAccountIds;
  index.data = { categories: { ...categories, next } };

  const result = await service.reclassify(
    Id,
    { categoryId: "next", fromCategoryId: "old" },
    { dryRun: true }
  );

  assert.ok("body" in result);
  const write = result.body.writes.find((w) => w.update?.name === `${Budget}/stashes/categories`);
  expect(JSON.stringify(write)).not.toContain("linkedAccountIds");
});

test("category reassignment retains a completed payment's recurrence and future clone without touching either", async () => {
  const { service, transaction, preview } = fixture();
  transaction.frequency = "ANNUALLY";
  transaction.clonedToTransactionId = "NextPayment";
  Object.assign(preview, { clonedToTransactionId: "NextPayment", frequency: "ANNUALLY" });

  const result = await service.reclassify(
    Id,
    { categoryId: "next", fromCategoryId: "old" },
    { dryRun: true }
  );

  assert.ok("body" in result);
  expect(
    result.body.writes.filter((w) => w.update?.name?.includes("/transactions/") === true)
  ).toHaveLength(1);
  expect(
    result.body.writes.find((w) => w.update?.name === `${Budget}/transactions/${Id}`)?.updateMask
      ?.fieldPaths
  ).toEqual(["targetTo.id"]);
});

test("a known debt reference keeps loan totals and linkage intact during category reassignment", async () => {
  const { service, transaction, docs } = fixture();
  transaction.extras = { loan: { objectId: "loan", stability: 0, stashId: "debts", type: "DEBT" } };
  docs.set(`${Budget}/stashes/debts`, {
    data: {
      loan: { id: "loan", totalInflowAmount: 0, totalOutflowAmount: 250, transactionCount: 1 },
    },
    id: "debts",
    type: "DEBTS",
  });

  const result = await service.reclassify(
    Id,
    { categoryId: "next", fromCategoryId: "old" },
    { dryRun: true }
  );

  assert.ok("body" in result);
  expect(result.body.writes.some((w) => w.update?.name === `${Budget}/stashes/debts`)).toBe(false);
  expect(
    result.body.writes.find((w) => w.update?.name === `${Budget}/transactions/${Id}`)?.updateMask
      ?.fieldPaths
  ).toEqual(["targetTo.id"]);
});

test("a live category-only request is payload-bound before dispatch and an identical request never resends", async () => {
  const { service, client, requests } = fixture();
  const requestId = "C".repeat(20);

  const result = await service.reclassify(
    Id,
    { categoryId: "next", fromCategoryId: "old" },
    { requestId }
  );

  expect(result).toMatchObject({ committed: true, requestId });
  const operation = await new TransactionOperations(client, { home: Home }).operation(requestId);
  expect(operation.manifest.intent).toEqual({
    action: "reclassify",
    input: { categoryId: "next", fromCategoryId: "old" },
    transactionId: Id,
  });
  expect(operation.state.status).toBe("committed");
  expect(operation.acknowledgment?.response.commitTime).toBe(Time);
  expect(operation.acknowledgment?.response.writeResults).toHaveLength(
    operation.submission?.body.writes.length ?? -1
  );
  assert.deepEqual(
    operation.submission?.body,
    requests.find((r) => r.path.endsWith(":commit"))?.body
  );
  await assert.rejects(
    service.reclassify(Id, { categoryId: "next", fromCategoryId: "old" }, { requestId })
  );
  await assert.rejects(
    service.reclassify(Id, { categoryId: "next", fromCategoryId: "other" }, { requestId }),
    /different payload/u
  );
  expect(requests.filter((r) => r.path.endsWith(":commit"))).toHaveLength(1);
});

test.each(["lost", "short", "conflict"])(
  "a %s acknowledgment cannot trigger financial replay",
  async (outcome) => {
    const { service, client, requests, fail } = fixture();
    const requestId = (outcome === "conflict" ? "F" : outcome.slice(0, 1).toUpperCase()).repeat(20);
    fail(outcome);
    await assert.rejects(
      service.reclassify(Id, { categoryId: "next", fromCategoryId: "old" }, { requestId })
    );
    const operation = await new TransactionOperations(client, { home: Home }).operation(requestId);
    expect(operation.state.status).toBe(outcome === "conflict" ? "rejected" : "unknown");
    await assert.rejects(
      service.reclassify(Id, { categoryId: "next", fromCategoryId: "old" }, { requestId })
    );
    expect(requests.filter((r) => r.path.endsWith(":commit"))).toHaveLength(1);
  }
);

test.each([
  "source-intent",
  "preview-amount",
  "destination-count",
  "reverse-link",
  "source-spending",
])("invalid %s prevents a category-only dispatch", async (fault) => {
  const { service, transaction, preview, docs, requests } = fixture();

  const index = DataSchema.parse(
    DataSchema.parse(docs.get(`${Budget}/stashes/categories`)?.data).categories
  );

  if (fault === "source-intent") {
    transaction.targetTo = {
      id: "other",
      linkedObjectId: null,
      linkedObjectType: null,
      type: "CATEGORY",
    };
  }

  if (fault === "preview-amount") {
    preview.amount = -999;
  }

  if (fault === "destination-count") {
    const doc = docs.get(`${Budget}/stashes/categories`);
    assert.ok(doc);
    doc.data = {
      categories: {
        ...index,
        next: { ...DataSchema.parse(index.next), transactionCount: Number.MAX_SAFE_INTEGER },
      },
    };
  }

  if (fault === "reverse-link") {
    const doc = docs.get(`${Budget}/stashes/accounts`);
    assert.ok(doc);
    const accounts = DataSchema.parse(doc.data);
    doc.data = {
      ...accounts,
      bank: { ...DataSchema.parse(accounts.bank), linkedCategoryId: "next" },
    };
  }

  if (fault === "source-spending") {
    const doc = docs.get(`${Budget}/periods/october`);
    assert.ok(doc);
    const balances = DataSchema.parse(doc.balances);
    const old = DataSchema.parse(balances.old);
    delete old.spentAmount;
    doc.balances = { ...balances, old };
  }

  await assert.rejects(
    service.reclassify(Id, { categoryId: "next", fromCategoryId: "old" }, { dryRun: true })
  );
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test("missing destination spending cannot erase an existing expense in that month", async () => {
  const { service, docs, requests, preview } = fixture();
  const stash = docs.get(`${Budget}/stashes/next`);
  const period = docs.get(`${Budget}/periods/october`);
  const index = docs.get(`${Budget}/stashes/categories`);
  assert.ok(stash && period && index);
  const data = DataSchema.parse(stash.data);
  data.completedTransactionCount = 1;
  data.completedTransactions = {
    ExistingExpense00001: { ...preview, id: "ExistingExpense00001", targetToId: "next" },
  };
  data.historicalSpending = {};
  stash.data = data;

  const next = DataSchema.parse(DataSchema.parse(period.balances).next);
  delete next.spentAmount;
  period.balances = { ...DataSchema.parse(period.balances), next };

  const categories = DataSchema.parse(DataSchema.parse(index.data).categories);
  categories.next = { ...DataSchema.parse(categories.next), transactionCount: 1 };
  index.data = { ...DataSchema.parse(index.data), categories };
  await assert.rejects(
    service.reclassify(Id, { categoryId: "next", fromCategoryId: "old" }, { dryRun: true }),
    /Destination spending/u
  );
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});
