/* oxlint-disable func-style, no-await-in-loop -- Named fixtures keep native write expectations independent. */
import { afterEach, expect, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { captureExecute } from "@crustjs/testing";
import { z } from "zod";

import { createApp } from "../cli/app.ts";
import { BeyondClient } from "../firestore/client.ts";
import type { Fetcher } from "../firestore/client.ts";
import { DataSchema, DocumentRoot, encodeFields } from "../firestore/encoding.ts";
import { CategoryArchiveService } from "./category-archive.ts";

const BudgetPath = `${DocumentRoot}/budgets/creationLab`;
const IndexPath = `${BudgetPath}/stashes/categoryIndex`;
const Timestamp = "2026-11-01T00:00:00Z";
const Input = { categoryId: "old", month: new Date().toISOString().slice(0, 7) };
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (path) => {
      await rm(path, { force: true, recursive: true });
    })
  );
});

async function fixture() {
  const home = await mkdtemp(nodePath.join(tmpdir(), "bebu-category-archive-"));
  directories.push(home);

  const budget = {
    availablePeriods: {},
    id: "creationLab",
    stashIdentifiers: {
      ACCOUNTS: "accounts",
      GROUPS_AND_CATEGORIES: "categoryIndex",
      TRANSACTIONS: "transactions",
      TRANSACTION_TEMPLATES: "templates",
    },
    type: "ZERO_BASED",
  };

  const index = {
    data: {
      categories: {
        old: {
          archived: false,
          color: "PINK",
          groupId: "home",
          icon: "CRUISE_SHIP",
          id: "old",
          modifiable: true,
          name: "Old",
          order: 5,
          target: null,
          type: "DEFAULT",
          unknown: "preserve",
        },
      },
      groups: { home: { id: "home", modifiable: true, name: "Home", type: "DEFAULT" } },
    },
    id: "categoryIndex",
    type: "GROUPS_AND_CATEGORIES",
  };

  const requests: { path: string; body: ReturnType<typeof DataSchema.parse> }[] = [];
  let mode = "success";

  const documents = new Map<string, ReturnType<typeof DataSchema.parse>>([
    [BudgetPath, budget],
    [IndexPath, index],
    [`${DocumentRoot}/users/fixtureUser`, { config: { timezone: "UTC" } }],
    [
      `${BudgetPath}/stashes/accounts`,
      { data: { account: { id: "account", type: "SAVINGS" } }, id: "accounts", type: "ACCOUNTS" },
    ],
    [
      `${BudgetPath}/stashes/old`,
      { data: { historicalSpending: { "2025-01": 123 } }, id: "old", type: "CATEGORY" },
    ],
    [
      `${BudgetPath}/stashes/transactions`,
      { data: { upcomingTransactions: {} }, id: "transactions", type: "TRANSACTIONS" },
    ],
    [
      `${BudgetPath}/stashes/templates`,
      { data: {}, id: "templates", type: "TRANSACTION_TEMPLATES" },
    ],
  ]);

  const canonical: ReturnType<typeof DataSchema.parse>[] = [];

  const fetcher: Fetcher = async (input, init) =>
    await Promise.resolve(
      (() => {
        const path = new URL(new Request(input).url).pathname.slice(4);

        const body =
          init?.body === undefined || init.body === null
            ? {}
            : DataSchema.parse(JSON.parse(z.string().parse(init.body)));

        requests.push({ body, path });

        if (path.endsWith(":beginTransaction")) {
          return Response.json({ transaction: "archive-snapshot" });
        }

        if (path.endsWith(":rollback")) {
          return Response.json({});
        }

        if (path.endsWith(":batchGet")) {
          return Response.json(
            z
              .array(z.string())
              .parse(body.documents)
              .map((name) => {
                const data = documents.get(name);

                return data
                  ? { found: { fields: encodeFields(data), name, updateTime: Timestamp } }
                  : { missing: name };
              })
          );
        }

        if (path.endsWith(":runQuery")) {
          return Response.json(
            canonical
              .values()
              .filter((data) => {
                const query = z
                  .object({
                    structuredQuery: z.object({
                      where: z.object({
                        fieldFilter: z.object({ field: z.object({ fieldPath: z.string() }) }),
                      }),
                    }),
                  })
                  .parse(body);

                const [key] = query.structuredQuery.where.fieldFilter.field.fieldPath.split(".");

                return (
                  key !== undefined &&
                  z.object({ id: z.string() }).safeParse(data[key]).data?.id === "old"
                );
              })
              .map((data) => ({
                document: {
                  fields: encodeFields(data),
                  name: `${BudgetPath}/transactions/${z.string().parse(data.id)}`,
                  updateTime: Timestamp,
                },
              }))
              .toArray()
          );
        }

        if (path.includes("/saveMarkers/")) {
          return Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 });
        }

        if (path.endsWith(":commit")) {
          if (mode === "conflict") {
            return Response.json(
              { error: { message: "changed", status: "ABORTED" } },
              { status: 409 }
            );
          }

          if (mode === "lost") {
            throw new Error("lost original response");
          }

          return Response.json({
            commitTime: Timestamp,
            writeResults:
              mode === "incomplete"
                ? [{}]
                : z
                    .array(z.unknown())
                    .parse(body.writes)
                    .map(() => ({})),
          });
        }

        if (init?.method === "GET" && (path === BudgetPath || path === IndexPath)) {
          return Response.json({
            fields: encodeFields(path === BudgetPath ? budget : index),
            name: path,
            updateTime: Timestamp,
          });
        }

        if (init?.method === "GET") {
          return Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 });
        }

        throw new Error(`Unexpected archive request ${path}`);
      })()
    );

  const client = new BeyondClient(
    {
      budgetIds: ["creationLab"],
      expiresAt: Date.now() + 3_600_000,
      idToken: "synthetic",
      importedAt: Timestamp,
      projectId: "beyond-budget",
      stashes: [],
      uid: "fixtureUser",
      version: 1,
    },
    { budget: "creationLab", fetcher }
  );

  return {
    budget,
    canonical,
    client,
    documents,
    fetcher,
    home,
    index,
    requests,
    service: new CategoryArchiveService(client, { home }),
    setMode: (value: string) => {
      mode = value;
    },
  };
}

test("archive emits only native archived fields and parent deletion while preserving historical records", async () => {
  const { service, index, documents, requests } = await fixture();
  const before = structuredClone([...documents]);
  const result = await service.archive(Input, { dryRun: true });
  assert.ok("body" in result);
  expect(result.body.writes).toHaveLength(2);
  const [write] = result.body.writes;
  expect(write?.update?.name).toBe(IndexPath);
  expect(write?.currentDocument).toEqual({ updateTime: Timestamp });
  expect(write?.updateMask?.fieldPaths).toEqual([
    "data.categories.old.archived",
    "data.categories.old.archivedAt",
    "data.categories.old.parentCategoryId",
  ]);
  expect(write?.update?.fields).toEqual(
    encodeFields({
      data: {
        categories: { old: { archived: true, archivedAt: new Date(result.summary.archivedAt) } },
      },
    })
  );
  expect(result.summary).toMatchObject({
    financialChanges: false,
    fundsEvaluated: false,
    upcomingRewriteOmitted: true,
  });
  expect([...documents]).toEqual(before);
  expect(index.data.categories.old.unknown).toBe("preserve");
  expect(requests.filter((r) => r.path.endsWith(":runQuery"))).toHaveLength(3);
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test("archive excludes obligations in canonical history even when all stashes are empty", async () => {
  const { service, canonical, requests } = await fixture();
  canonical.push({
    budgetId: "creationLab",
    completed: false,
    id: "future",
    targetTo: { id: "old" },
  });
  await assert.rejects(service.archive(Input, { dryRun: true }), /completed:true/u);
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test("archive permits completed reconciled history without editing it", async () => {
  const { service, canonical } = await fixture();
  canonical.push({
    budgetId: "creationLab",
    completed: true,
    id: "past",
    reconciled: true,
    splitId: "split",
    targetTo: { id: "old" },
  });
  const result = await service.archive(Input, { dryRun: true });
  expect(result.summary.historicalReferenceMatches).toBe(1);
});

test("archive rejects children, targets, links and future months before dispatch", async () => {
  const { service, documents, index, requests } = await fixture();

  for (const [key, value] of [
    ["target", {}],
    ["linkedAccountIds", ["account"]],
    ["archived", true],
    ["modifiable", false],
  ] as const) {
    const previous = { ...index.data.categories.old };
    Object.assign(index.data.categories.old, { [key]: value });
    await assert.rejects(service.archive(Input, { dryRun: true }));
    index.data.categories.old = previous;
  }

  const previousCategories = index.data.categories;
  Object.assign(index.data, {
    categories: { ...previousCategories, child: { id: "child", parentCategoryId: "old" } },
  });
  await assert.rejects(service.archive(Input, { dryRun: true }), /childless/u);
  index.data.categories = previousCategories;
  const accounts = documents.get(`${BudgetPath}/stashes/accounts`);
  assert.ok(accounts);
  accounts.data = { account: { id: "account", linkedCategoryId: "old" } };
  await assert.rejects(service.archive(Input, { dryRun: true }), /linked accounts/u);
  await assert.rejects(
    service.archive({ ...Input, month: "2000-01" }, { dryRun: true }),
    /current month/u
  );
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test("archive rejects stale upcoming stash references and templates", async () => {
  const { service, documents } = await fixture();

  for (const [stash, bucket] of [
    ["old", "upcomingTransactions"],
    ["transactions", "upcomingTransactions"],
    ["templates", null],
  ] as const) {
    const doc = documents.get(`${BudgetPath}/stashes/${stash}`);
    assert.ok(doc);
    const before = structuredClone(doc.data);
    const record = { future: { id: "future", targetToId: "old" } };
    doc.data = bucket === null ? record : { [bucket]: record };
    await assert.rejects(service.archive(Input, { dryRun: true }), /obligations/u);
    doc.data = before;
  }
});

test("archive binds one live submission and never replays after lost acknowledgment", async () => {
  const { service, requests, setMode } = await fixture();
  setMode("lost");
  const options = { requestId: "ArchiveUnknown000001" };
  await assert.rejects(service.archive(Input, options));
  await assert.rejects(service.archive(Input, options));
  expect(requests.filter((r) => r.path.endsWith(":commit"))).toHaveLength(1);
  await assert.rejects(service.archive({ ...Input, categoryId: "other" }, options));
});

test("archive rejects OCC conflicts and incomplete acknowledgments without retries", async () => {
  for (const mode of ["conflict", "incomplete"]) {
    const { service, requests, setMode } = await fixture();
    setMode(mode);
    await assert.rejects(
      service.archive(Input, {
        requestId: mode === "conflict" ? "ArchiveConflict00001" : "ArchiveMalformed0001",
      })
    );
    expect(requests.filter((r) => r.path.endsWith(":commit"))).toHaveLength(1);
  }
});

test("archive CLI exposes explicit budget, month, preview and durable request flags", async () => {
  const result = await captureExecute(createApp(), ["categories", "archive", "--help"]);
  expect(result.stdout).toContain("--month");
  expect(result.stdout).toContain("--budget");
  expect(result.stdout).toContain("--request-id");
});

test("archive commits exactly once and requires the original complete acknowledgment", async () => {
  const { service, requests, client, home } = await fixture();
  const { TransactionOperations } = await import("./transaction-operations.ts");
  const options = { requestId: "ArchiveSuccess000001" };
  const result = await service.archive(Input, options);
  expect(result).toMatchObject({ committed: true });
  const operation = await new TransactionOperations(client, { home }).operation(options.requestId);
  expect(operation.state.status).toBe("committed");
  expect(operation.manifest.intent).toEqual({ action: "archive-category", input: Input });
  expect(operation.acknowledgment?.response.writeResults).toHaveLength(2);
  const commit = requests.find((r) => r.path.endsWith(":commit"));
  expect(commit?.body.transaction).toBe("archive-snapshot");
  expect(
    requests
      .filter((r) => r.path.endsWith(":batchGet") || r.path.endsWith(":runQuery"))
      .every((r) => r.body.transaction === "archive-snapshot")
  ).toBe(true);
  await assert.rejects(service.archive(Input, options));
  expect(requests.filter((r) => r.path.endsWith(":commit"))).toHaveLength(1);
});

test("archive preserves absent financial/link fields and deletes an explicit native parent only", async () => {
  const { service, index, documents } = await fixture();
  const before = structuredClone([...documents]);
  Object.assign(index.data.categories.old, { parentCategoryId: "parent" });
  Object.assign(index.data.categories, {
    parent: { groupId: "home", id: "parent", modifiable: true, type: "DEFAULT" },
  });
  const result = await service.archive(Input, { dryRun: true });
  assert.ok("body" in result);
  expect(result.summary.previousParentId).toBe("parent");
  expect(result.body.writes[0]?.updateMask?.fieldPaths).toHaveLength(3);

  const source = DataSchema.parse(
    z
      .object({ data: DataSchema })
      .parse(before.find(([path]) => path === `${BudgetPath}/stashes/accounts`)?.[1]).data
  );

  expect(source.account).toEqual({ id: "account", type: "SAVINGS" });
  expect(documents.get(`${BudgetPath}/stashes/accounts`)?.data).toEqual(source);
});

test("archive rejects malformed or missing identity evidence without dispatch", async () => {
  for (const mutation of ["identity", "account", "timezone", "upcoming"]) {
    const { service, index, documents, requests } = await fixture();

    if (mutation === "identity") {
      index.data.categories.old.id = "different";
    }

    if (mutation === "account") {
      documents.set(`${BudgetPath}/stashes/accounts`, {
        data: { account: { id: "wrong" } },
        id: "accounts",
        type: "ACCOUNTS",
      });
    }

    if (mutation === "timezone") {
      documents.set(`${DocumentRoot}/users/fixtureUser`, { config: {} });
    }

    if (mutation === "upcoming") {
      documents.set(`${BudgetPath}/stashes/transactions`, {
        data: {},
        id: "transactions",
        type: "TRANSACTIONS",
      });
    }

    await assert.rejects(service.archive(Input, { dryRun: true }));
    expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
  }
});

test("archive CLI forwards reviewed metadata intent and rejects omitted budget/month", async () => {
  const { client, fetcher, home } = await fixture();
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
      "categories",
      "archive",
      "old",
      "--budget",
      "creationLab",
      "--month",
      Input.month,
      "--request-id",
      "ArchivePreview000001",
      "--dry-run",
      "--full",
      "--compact",
    ]);

    expect(result.exitCode).toBe(0);

    const value = z
      .object({
        body: z.object({ writes: z.array(DataSchema) }),
        summary: z.object({
          categoryId: z.string(),
          financialChanges: z.literal(false),
          month: z.string(),
        }),
      })
      .parse(JSON.parse(result.stdout));

    expect(value.body.writes).toHaveLength(2);
    expect(value.summary).toMatchObject({ categoryId: "old", month: Input.month });
    const missing = await captureExecute(createApp(), ["categories", "archive", "old"]);
    expect(missing.exitCode).not.toBe(0);
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
  }
});
