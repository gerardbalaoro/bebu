/* oxlint-disable func-style -- Named fixtures keep native write expectations independent. */
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
import { CategoryCreationService } from "./category-create.ts";
import { TransactionOperations } from "./transaction-operations.ts";

const BudgetPath = `${DocumentRoot}/budgets/creationLab`;
const IndexPath = `${BudgetPath}/stashes/categoryIndex`;
const Timestamp = "2026-11-01T00:00:00Z";
const Input = { color: "PINK", groupId: "home", icon: "CRUISE_SHIP", name: "Supplies" };
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (path) => {
      await rm(path, { force: true, recursive: true });
    })
  );
});

async function fixture() {
  const home = await mkdtemp(nodePath.join(tmpdir(), "bebu-category-create-"));
  directories.push(home);

  const budget = {
    availablePeriods: {},
    id: "creationLab",
    stashIdentifiers: { GROUPS_AND_CATEGORIES: "categoryIndex" },
    type: "ZERO_BASED",
  };

  const index = {
    data: {
      categories: {
        old: {
          color: "PINK",
          groupId: "home",
          icon: "CRUISE_SHIP",
          id: "old",
          name: "Old",
          order: 5,
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
  let occupied = false;

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
          return Response.json({ transaction: "creation-snapshot" });
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
                if (name === BudgetPath || name === IndexPath) {
                  return {
                    found: {
                      fields: encodeFields(name === BudgetPath ? budget : index),
                      name,
                      updateTime: Timestamp,
                    },
                  };
                }

                return occupied
                  ? {
                      found: {
                        fields: encodeFields({ id: "existing" }),
                        name,
                        updateTime: Timestamp,
                      },
                    }
                  : { missing: name };
              })
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

        throw new Error(`Unexpected creation request ${path}`);
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
    client,
    fetcher,
    home,
    index,
    occupy: () => {
      occupied = true;
    },
    requests,
    service: new CategoryCreationService(client, { home }),
    setMode: (value: string) => {
      mode = value;
    },
  };
}

test("category creation appends a native ordinary record and empty stash without financial writes", async () => {
  const { service, index, requests } = await fixture();
  const original = structuredClone(index);
  const result = await service.create(Input, { dryRun: true });
  assert.ok("body" in result);
  const { id } = result.summary.category;
  expect(id).toMatch(/^[A-Za-z0-9]{20}$/u);
  expect(result.summary.category).toEqual({
    accumulationStrategy: "DEFAULT",
    accumulationStrategyOrder: 0,
    aggregateAllocationForTarget: false,
    amountComputationStrategy: "COMPUTE",
    archived: false,
    archivedAt: null,
    carryOverStrategy: "ALL",
    color: "PINK",
    deleted: false,
    groupId: "home",
    hidden: false,
    icon: "CRUISE_SHIP",
    id,
    lastTransactionAt: null,
    linkedAccountIds: [],
    lockedForChallenge: true,
    modifiable: true,
    name: "Supplies",
    nature: "UNCATEGORIZED",
    notes: "",
    order: 6,
    parentCategoryId: "",
    pinned: false,
    subcategoriesCollapsed: false,
    subcategoryAccumulationStrategy: "DEFAULT",
    systemGenerated: false,
    target: null,
    transactionCount: 0,
    type: "DEFAULT",
  });
  expect(result.body.writes.slice(0, 2)).toEqual([
    {
      currentDocument: { updateTime: Timestamp },
      update: {
        fields: encodeFields({ data: { categories: { [id]: result.summary.category } } }),
        name: IndexPath,
      },
      updateMask: {
        fieldPaths: [`data.categories.${/^[A-Za-z_]/u.test(id) ? id : `\`${id}\``}`],
      },
    },
    {
      currentDocument: { exists: false },
      update: {
        fields: encodeFields({ data: {}, id, type: "CATEGORY" }),
        name: `${BudgetPath}/stashes/${id}`,
      },
    },
  ]);
  expect(result.body.writes).toHaveLength(3);
  expect(result.summary.financialChanges).toBe(false);
  expect(requests[0]?.body).toEqual({ options: { readOnly: {} } });
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
  expect(index).toEqual(original);
});

test("category creation rejects ambiguous membership, order, styles and duplicate names", async () => {
  const { service, index, requests, occupy } = await fixture();

  await Promise.all(
    [
      { ...Input, groupId: "absent" },
      { ...Input, name: " old " },
      { ...Input, icon: "INVENTED" },
      { ...Input, color: "INVENTED" },
    ].map(async (input) => {
      await assert.rejects(service.create(input, { dryRun: true }));
    })
  );

  index.data.categories.old.order = Number.MAX_SAFE_INTEGER;
  await assert.rejects(service.create(Input, { dryRun: true }), /order/u);
  index.data.categories.old.order = 5;
  Object.assign(index.data.categories.old, { parentCategoryId: "parent" });
  await assert.rejects(service.create(Input, { dryRun: true }), /flat/u);
  Reflect.deleteProperty(index.data.categories.old, "parentCategoryId");
  index.data.groups.home.modifiable = false;
  await assert.rejects(service.create(Input, { dryRun: true }), /modifiable/u);
  index.data.groups.home.modifiable = true;
  occupy();
  await assert.rejects(service.create(Input, { dryRun: true }), /already exists/u);
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test.each(["conflict", "lost", "incomplete"])(
  "category creation retains %s outcomes without replay or a replacement identity",
  async (mode) => {
    const { service, client, home, requests, setMode } = await fixture();
    setMode(mode);
    const requestId = "CategoryCreateReq01X";
    await assert.rejects(service.create(Input, { requestId }));
    const operations = new TransactionOperations(client, { home });
    const original = await operations.operation(requestId);
    expect(original.manifest.intent.action).toBe("create-category");
    expect(original.state.status).toBe(mode === "conflict" ? "rejected" : "unknown");
    expect(original.submission?.body.writes).toHaveLength(3);
    await assert.rejects(service.create(Input, { requestId }), /No financial retry/u);
    await operations.recover(requestId);
    expect(requests.filter((r) => r.path.endsWith(":commit"))).toHaveLength(1);
  }
);

test("acknowledged creation binds its exact generated identity and both documents durably", async () => {
  const { service, client, home, requests } = await fixture();
  const requestId = "CategoryCreateReq02X";
  const result = await service.create(Input, { requestId });
  const original = await new TransactionOperations(client, { home }).operation(requestId);
  expect(original.state.status).toBe("committed");
  expect(original.submission?.body.transaction).toBe("creation-snapshot");
  expect(JSON.stringify(original.submission?.body)).toContain(result.summary.category.id);
  await assert.rejects(
    service.create({ ...Input, name: "Other" }, { requestId }),
    /different payload/u
  );
  expect(requests.filter((r) => r.path.endsWith(":commit"))).toHaveLength(1);
});

test("CLI category creation requires explicit context and returns the native dry-run contract", async () => {
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
      "create",
      "--budget",
      "creationLab",
      "--group",
      "home",
      "--name",
      "Supplies",
      "--icon",
      "CRUISE_SHIP",
      "--color",
      "PINK",
      "--dry-run",
      "--full",
      "--compact",
    ]);

    expect(result.exitCode).toBe(0);

    const value = z
      .object({
        body: z.object({ writes: z.array(DataSchema) }),
        summary: z.object({ category: DataSchema }),
      })
      .parse(JSON.parse(result.stdout));

    expect(value.summary.category).toMatchObject({ groupId: "home", name: "Supplies", order: 6 });
    expect(value.body.writes).toHaveLength(3);

    const missing = await captureExecute(createApp(), [
      "categories",
      "create",
      "--name",
      "Supplies",
    ]);

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

test.each([{ order: undefined }, { order: null }, { groupId: undefined }, { id: "different" }])(
  "creation never fills missing or conflicting peer fields: %j",
  async (fields) => {
    const { index, service, requests } = await fixture();
    Object.assign(index.data.categories.old, fields);
    await assert.rejects(service.create(Input, { dryRun: true }));
    expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
  }
);

test("empty and duplicate-order groups remain outside the creation ordering contract", async () => {
  const { index, service } = await fixture();
  index.data.categories.old.groupId = "other";
  await assert.rejects(service.create(Input, { dryRun: true }), /empty group/u);
  index.data.categories.old.groupId = "home";
  Object.assign(index.data.categories, {
    peer: { ...index.data.categories.old, id: "peer", name: "Other" },
  });
  await assert.rejects(service.create(Input, { dryRun: true }), /unique/u);
});
