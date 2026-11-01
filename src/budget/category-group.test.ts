/* oxlint-disable func-style, no-await-in-loop -- Named fixtures exercise exact patches and permanent request ownership. */
import { expect, spyOn, test } from "bun:test";
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
import { CategoryGroupService } from "./category-group.ts";
import { TransactionOperations } from "./transaction-operations.ts";

const BudgetPath = `${DocumentRoot}/budgets/groupMoveLab`;
const IndexPath = `${BudgetPath}/stashes/categories`;
const AccountsPath = `${BudgetPath}/stashes/accounts`;
const Timestamp = "2026-11-02T00:00:00Z";
const Input = { categoryId: "source", fromGroupId: "old", groupId: "next" };

function fixture() {
  const category = { modifiable: true, name: "Category", type: "DEFAULT" };

  const budget = {
    availablePeriods: {},
    id: "groupMoveLab",
    stashIdentifiers: { ACCOUNTS: "accounts", GROUPS_AND_CATEGORIES: "categories" },
    type: "ZERO_BASED",
  };

  const accounts = {
    data: z.record(z.string(), DataSchema).parse({ bank: { id: "bank", linkedCategoryId: null } }),
    id: "accounts",
    type: "ACCOUNTS",
  };

  const index = {
    data: {
      categories: z
        .object({ first: DataSchema, last: DataSchema, left: DataSchema, source: DataSchema })
        .parse({
          first: { ...category, groupId: "next", id: "first", order: 1 },
          last: { ...category, groupId: "next", id: "last", order: 5 },
          left: { ...category, groupId: "old", id: "left", order: 7 },
          source: { ...category, groupId: "old", id: "source", order: 2, unknown: "preserve" },
        }),
      groups: z.record(z.string(), DataSchema).parse({
        next: { id: "next", modifiable: true, order: 3, type: "DEFAULT" },
        old: { id: "old", modifiable: true, order: 1, type: "DEFAULT" },
      }),
    },
    id: "categories",
    type: "GROUPS_AND_CATEGORIES",
  };

  const requests: { path: string; body: ReturnType<typeof DataSchema.parse> }[] = [];
  let outcome = "success";

  const fetcher: Fetcher = async (input, init) => {
    const path = new URL(new Request(input).url).pathname.slice(4);

    const body =
      init?.body !== undefined && init.body !== null
        ? DataSchema.parse(await new Response(init.body).json())
        : {};

    requests.push({ body, path });

    if (path.endsWith(":beginTransaction")) {
      return Response.json({ transaction: "group-move-read-snapshot" });
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
            const document = new Map<string, z.infer<typeof DataSchema>>([
              [BudgetPath, budget],
              [AccountsPath, accounts],
              [IndexPath, index],
            ]).get(name);

            assert.ok(document);

            return {
              found: {
                fields: encodeFields(document),
                name,
                updateTime: Timestamp,
              },
            };
          })
      );
    }

    if (path.includes("/saveMarkers/")) {
      return Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 });
    }

    if (path.endsWith(":commit")) {
      if (outcome === "lost") {
        throw new Error("lost original acknowledgment");
      }

      if (outcome === "conflict") {
        return Response.json({ error: { status: "ABORTED" } }, { status: 409 });
      }

      return Response.json({
        commitTime: Timestamp,
        writeResults: outcome === "incomplete" ? [{}] : [{ updateTime: Timestamp }, {}],
      });
    }

    if (init?.method === "GET") {
      return Response.json({ fields: encodeFields(index), name: IndexPath, updateTime: Timestamp });
    }

    throw new Error(`Preview attempted an unexpected request: ${path}`);
  };

  const client = new BeyondClient(
    {
      budgetIds: ["groupMoveLab"],
      expiresAt: Date.now() + 3_600_000,
      idToken: "synthetic",
      importedAt: Timestamp,
      projectId: "beyond-budget",
      stashes: [],
      uid: "fixtureUser",
      version: 1,
    },
    { fetcher }
  );

  return {
    accounts,
    budget,
    client,
    fail: (mode: string) => {
      outcome = mode;
    },
    fetcher,
    index,
    requests,
  };
}

test("live group move binds the exact two-write envelope and never resends a claimed identity", async () => {
  const { client, requests } = fixture();
  const home = await mkdtemp(nodePath.join(tmpdir(), "bebu-group-live-"));

  try {
    const service = new CategoryGroupService(client, { home });
    const options = { requestId: "GroupMoveSuccess0001" };
    const result = await service.move(Input, options);
    expect(result).toMatchObject({ committed: true, requestId: options.requestId });

    const operation = await new TransactionOperations(client, { home }).operation(
      options.requestId
    );

    expect(operation.manifest.intent).toEqual({ action: "move-category", input: Input });
    expect(operation.state.status).toBe("committed");
    expect(operation.submission?.body.transaction).toBe("group-move-read-snapshot");
    expect(operation.submission?.body.writes).toHaveLength(2);
    expect(requests[0]?.body).toEqual({
      options: { readWrite: { concurrencyMode: "OPTIMISTIC" } },
    });
    await assert.rejects(service.move(Input, options));
    await assert.rejects(
      service.move({ ...Input, groupId: "another" }, options),
      /different payload/u
    );
    expect(requests.filter((r) => r.path.endsWith(":commit"))).toHaveLength(1);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("group moves reject reverse account links and missing link evidence even with a sparse category", async () => {
  for (const value of ["source", undefined, 42, "invalid link"]) {
    const { accounts, client } = fixture();
    const account = accounts.data.bank;
    assert.ok(account);

    if (value === undefined) {
      delete account.linkedCategoryId;
    } else {
      account.linkedCategoryId = value;
    }

    await assert.rejects(
      new CategoryGroupService(client).move(Input, { dryRun: true }),
      /account/u
    );
  }
});

test.each([
  { mode: "conflict", status: "rejected" },
  { mode: "lost", status: "unknown" },
  { mode: "incomplete", status: "unknown" },
])("group move $mode preserves its outcome and forbids replay", async ({ mode, status }) => {
  const { client, requests, fail } = fixture();
  const home = await mkdtemp(nodePath.join(tmpdir(), "bebu-group-failure-"));

  try {
    fail(mode);
    const service = new CategoryGroupService(client, { home });
    const options = { requestId: "GroupMoveFailure0001" };
    await assert.rejects(service.move(Input, options));

    const operation = await new TransactionOperations(client, { home }).operation(
      options.requestId
    );

    expect(operation.state.status).toBe(status);
    await assert.rejects(service.move(Input, options));
    expect(requests.filter((r) => r.path.endsWith(":commit"))).toHaveLength(1);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("group move preview appends after the highest destination order and patches only membership and order", async () => {
  const { client, index, requests } = fixture();
  const before = structuredClone(index);
  const result = await new CategoryGroupService(client).move(Input, { dryRun: true });
  assert.ok("body" in result);
  expect(result.summary).toMatchObject({
    executionSupported: true,
    groupId: { after: "next", before: "old" },
    order: { after: 6, before: 2 },
  });
  expect(result.body.writes[0]).toEqual({
    currentDocument: { updateTime: Timestamp },
    update: {
      fields: encodeFields({ data: { categories: { source: { groupId: "next", order: 6 } } } }),
      name: IndexPath,
    },
    updateMask: { fieldPaths: ["data.categories.source.groupId", "data.categories.source.order"] },
  });
  expect(result.body.writes).toHaveLength(2);
  expect(index).toEqual(before);
  expect(requests[0]?.body).toEqual({ options: { readOnly: {} } });
  expect(requests.every((request) => !request.path.endsWith(":commit"))).toBe(true);
});

test.each([
  { field: "groupId", value: "different" },
  { field: "parentCategoryId", value: "left" },
  { field: "target", value: { amount: 100 } },
  { field: "linkedAccountIds", value: ["bank"] },
  { field: "linkedAccountIds", value: null },
  { field: "modifiable", value: false },
  { field: "type", value: "CREDIT_CARD_PAYMENT" },
])(
  "group move preview rejects unsupported source state: $field=$value",
  async ({ field, value }) => {
    const { client, index } = fixture();
    index.data.categories.source[field] = value;
    await assert.rejects(new CategoryGroupService(client).move(Input, { dryRun: true }));
  }
);

test("group move preview rejects order collisions, missing orders, overflow, children and empty destinations", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.index.data.categories.first.order = 5;
    },
    (f: ReturnType<typeof fixture>) => {
      delete f.index.data.categories.last.order;
    },
    (f: ReturnType<typeof fixture>) => {
      f.index.data.categories.last.order = 2_147_483_647;
    },
    (f: ReturnType<typeof fixture>) => {
      f.index.data.categories.left.parentCategoryId = "source";
    },
    (f: ReturnType<typeof fixture>) => {
      f.index.data.categories.last.parentCategoryId = "first";
    },
    (f: ReturnType<typeof fixture>) => {
      Reflect.deleteProperty(f.index.data.categories, "first");
      Reflect.deleteProperty(f.index.data.categories, "last");
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(new CategoryGroupService(f.client).move(Input, { dryRun: true }));
  }
});

test("group move preview rejects reverse direction and missing group order instead of inferring native placement", async () => {
  for (const value of [undefined, 0, 1]) {
    const { client, index } = fixture();
    const destination = index.data.groups.next;
    assert.ok(destination);
    destination.order = value;
    await assert.rejects(new CategoryGroupService(client).move(Input, { dryRun: true }));
  }
});

test("category group move requires expected source intent before auth or network access", async () => {
  const result = await captureExecute(createApp(), [
    "categories",
    "move",
    "source",
    "--group",
    "next",
    "--budget",
    "groupMoveLab",
    "--compact",
  ]);

  expect(result.exitCode).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("from-group");
});

test("CLI group move preview carries explicit source intent through one isolated read-only snapshot", async () => {
  const { client, fetcher, requests } = fixture();
  const home = await mkdtemp(nodePath.join(tmpdir(), "bebu-group-move-"));
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
      "move",
      "source",
      "--from-group",
      "old",
      "--group",
      "next",
      "--budget",
      "groupMoveLab",
      "--dry-run",
      "--full",
      "--compact",
    ]);

    expect(result.exitCode, result.stdout + result.stderr).toBe(0);

    const value = z
      .object({
        dryRun: z.literal(true),
        summary: z.object({
          executionSupported: z.literal(true),
          groupId: z.object({ after: z.string(), before: z.string() }),
        }),
      })
      .parse(JSON.parse(result.stdout));

    expect(value.summary.groupId).toEqual({ after: "next", before: "old" });
    expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);

    const applied = await captureExecute(createApp(), [
      "categories",
      "move",
      "source",
      "--from-group",
      "old",
      "--group",
      "next",
      "--budget",
      "groupMoveLab",
      "--request-id",
      "CliGroupMove00000001",
      "--compact",
    ]);

    expect(applied.exitCode, applied.stdout + applied.stderr).toBe(0);
    expect(JSON.parse(applied.stdout)).toMatchObject({
      committed: true,
      requestId: "CliGroupMove00000001",
    });
    expect(requests.filter((request) => request.path.endsWith(":commit"))).toHaveLength(1);

    const rejected = await captureExecute(createApp(), [
      "categories",
      "move",
      "source",
      "--from-group",
      "next",
      "--group",
      "old",
      "--budget",
      "groupMoveLab",
      "--dry-run",
      "--compact",
    ]);

    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.stdout + rejected.stderr).toContain("expected source group");
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
