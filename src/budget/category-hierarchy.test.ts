/* oxlint-disable func-style, no-await-in-loop -- Named fixtures and sequential CLI observations exercise the shared native boundary. */
import { expect, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { captureExecute } from "@crustjs/testing";
import { z } from "zod";

import { createApp } from "../cli/app.ts";
import { BeyondClient } from "../firestore/client.ts";
import type { Fetcher } from "../firestore/client.ts";
import { DataSchema, DocumentRoot, encodeFields } from "../firestore/encoding.ts";
import type { Data } from "../firestore/encoding.ts";
import { changeCategoryParent } from "./category-hierarchy.ts";

const BudgetPath = `${DocumentRoot}/budgets/hierarchyLab`;
const IndexPath = `${BudgetPath}/stashes/categories`;
const AccountPath = `${BudgetPath}/stashes/accounts`;
const Timestamp = "2026-11-01T00:00:00Z";

function fixture() {
  const categories = z.record(z.string(), DataSchema).parse({
    child: {
      groupId: "needs",
      id: "child",
      modifiable: true,
      name: "Child",
      order: 1,
      parentCategoryId: "parent",
      type: "DEFAULT",
      unknownSetting: "keep",
    },
    parent: {
      groupId: "needs",
      id: "parent",
      modifiable: true,
      name: "Parent",
      order: 0,
      type: "DEFAULT",
    },
    sibling: {
      groupId: "needs",
      id: "sibling",
      modifiable: true,
      name: "Sibling",
      order: 2,
      parentCategoryId: "parent",
      type: "DEFAULT",
    },
    unrelated: {
      groupId: "needs",
      id: "unrelated",
      modifiable: true,
      name: "Unrelated",
      order: 3,
      type: "DEFAULT",
    },
  });

  const groups = z.record(z.string(), DataSchema).parse({
    needs: { id: "needs", modifiable: true, name: "Needs", type: "DEFAULT" },
  });

  const accounts = z.record(z.string(), DataSchema).parse({
    bank: { id: "bank", linkedCategoryId: "", name: "Bank", type: "SAVINGS" },
  });

  const documents = z.record(z.string(), DataSchema).parse({
    [AccountPath]: { data: accounts },
    [BudgetPath]: {
      availablePeriods: { "2026-11": { id: "currentPeriod" } },
      stashIdentifiers: { ACCOUNTS: "accounts", GROUPS_AND_CATEGORIES: "categories" },
    },
    [IndexPath]: { data: { categories, groups } },
  });

  const requests: { body: Data; path: string }[] = [];
  let conflict = false;
  let markerOnly = false;

  const fetcher: Fetcher = async (input, init) => {
    const requestPath = new URL(new Request(input).url).pathname.slice(4);

    const body =
      init?.body === undefined || init.body === null
        ? {}
        : DataSchema.parse(await new Response(init.body).json());

    requests.push({ body, path: requestPath });

    if (init?.method === "GET" && Object.hasOwn(documents, requestPath)) {
      return Response.json({
        fields: encodeFields(documents[requestPath] ?? {}),
        name: requestPath,
        updateTime: Timestamp,
      });
    }

    if (requestPath.endsWith(":beginTransaction")) {
      return Response.json({ transaction: "hierarchy-snapshot" });
    }

    if (requestPath.endsWith(":rollback")) {
      return Response.json({});
    }

    if (requestPath.endsWith(":batchGet")) {
      return Response.json(
        z
          .array(z.string())
          .parse(body.documents)
          .map((name) => {
            assert.ok(documents[name], `Unexpected read ${name}`);

            return {
              found: { fields: encodeFields(documents[name]), name, updateTime: Timestamp },
            };
          })
      );
    }

    if (requestPath.endsWith(":commit")) {
      if (conflict) {
        return Response.json({ error: { message: "changed", status: "ABORTED" } }, { status: 409 });
      }

      return Response.json({ commitTime: Timestamp, writeResults: [] });
    }

    if (requestPath.includes("/saveMarkers/")) {
      return markerOnly
        ? Response.json({
            fields: encodeFields({ createdAt: Timestamp }),
            name: requestPath,
            updateTime: Timestamp,
          })
        : Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 });
    }

    throw new Error(`Unexpected hierarchy request ${requestPath}`);
  };

  const client = new BeyondClient(
    {
      budgetIds: ["hierarchyLab"],
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
    categories,
    client,
    documents,
    fetcher,
    groups,
    requests,
    setConflict: () => {
      conflict = true;
    },
    setMarkerOnly: () => {
      conflict = true;
      markerOnly = true;
    },
  };
}

const Detach = { action: "detach", categoryId: "child", parentId: "parent" } as const;
const Attach = { ...Detach, action: "attach" } as const;

test("detach deletes only the parent link, preserves siblings and order, and previews derived effects", async () => {
  const { client, documents, requests } = fixture();
  const before = structuredClone(documents);
  const result = await changeCategoryParent(client, Detach, { dryRun: true });
  assert.ok("dryRun" in result);
  expect(result.body.writes[0]).toEqual({
    currentDocument: { updateTime: Timestamp },
    update: { fields: encodeFields({ data: { categories: { child: {} } } }), name: IndexPath },
    updateMask: { fieldPaths: ["data.categories.child.parentCategoryId"] },
  });
  expect(result.body.writes).toHaveLength(2);
  expect(result.summary).toMatchObject({
    categoryId: "child",
    directFundingChanges: false,
    fundingOutcomesPredicted: false,
    groupId: "needs",
    order: 1,
    parent: { after: null, before: "parent" },
    parentCoverageMembership: "removed",
  });
  expect(documents).toEqual(before);
  expect(requests[0]?.body).toEqual({ options: { readOnly: {} } });
  expect(
    requests
      .filter((r) => r.path.endsWith(":batchGet"))
      .every((r) => r.body.transaction === "hierarchy-snapshot")
  ).toBe(true);
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test("same-group attach writes native parent and group fields together without reordering or a subtree move", async () => {
  const { client, categories, documents } = fixture();
  Reflect.deleteProperty(categories.child ?? {}, "parentCategoryId");
  const before = structuredClone(documents);
  const result = await changeCategoryParent(client, Attach, { dryRun: true });
  assert.ok("dryRun" in result);
  expect(result.body.writes[0]).toEqual({
    currentDocument: { updateTime: Timestamp },
    update: {
      fields: encodeFields({
        data: { categories: { child: { groupId: "needs", parentCategoryId: "parent" } } },
      }),
      name: IndexPath,
    },
    updateMask: {
      fieldPaths: ["data.categories.child.parentCategoryId", "data.categories.child.groupId"],
    },
  });
  expect(result.summary).toMatchObject({
    order: 1,
    parent: { after: "parent", before: null },
    parentCoverageMembership: "added",
  });
  expect(documents).toEqual(before);
});

test.each(["attach", "detach"] as const)(
  "%s cannot move the current relationship under stale expected parent intent",
  async (action) => {
    const { client, categories, requests } = fixture();
    categories.child = {
      ...categories.child,
      parentCategoryId: action === "attach" ? "parent" : "unrelated",
    };
    await assert.rejects(changeCategoryParent(client, { ...Detach, action }), /parent|top-level/u);
    expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
  }
);

test.each([
  { archived: true },
  { deleted: true },
  { modifiable: false },
  { type: "CREDIT_CARD_PAYMENT" },
  { linkedAccountIds: ["bank"] },
  { linkedAccountIds: null },
  { target: null },
  { aggregateAllocationForTarget: true },
  { aggregateAllocationForTarget: false },
  { accumulationStrategy: "DEFAULT" },
  { computationStrategy: "COMPUTE" },
])(
  "hierarchy changes reject unsupported family state rather than overwriting it: %j",
  async (settings) => {
    const { client, categories, requests } = fixture();
    Object.assign(categories.sibling ?? {}, settings);
    await assert.rejects(changeCategoryParent(client, Detach));
    expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
  }
);

test("missing or contradictory account link evidence blocks hierarchy execution", async () => {
  const { client, accounts, requests } = fixture();
  Reflect.deleteProperty(accounts.bank ?? {}, "linkedCategoryId");
  await assert.rejects(changeCategoryParent(client, Detach), /account link/u);
  Object.assign(accounts.bank ?? {}, { linkedCategoryId: "parent" });
  await assert.rejects(changeCategoryParent(client, Detach), /linked account/u);
  Object.assign(accounts.bank ?? {}, { id: "other", linkedCategoryId: "" });
  await assert.rejects(changeCategoryParent(client, Detach), /identity/u);
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test("stored category identity, group identity, and membership must agree", async () => {
  const { client, categories, groups } = fixture();
  Object.assign(categories.child ?? {}, { id: "other" });
  await assert.rejects(changeCategoryParent(client, Detach), /identity/u);
  Object.assign(categories.child ?? {}, { groupId: "otherGroup", id: "child" });
  await assert.rejects(changeCategoryParent(client, Detach), /same group/u);
  Object.assign(categories.child ?? {}, { groupId: "needs" });
  Object.assign(groups.needs ?? {}, { id: "other" });
  await assert.rejects(changeCategoryParent(client, Detach), /identity/u);
});

test("self-parenting, cycles, nested parents and source descendants cannot produce hierarchy writes", async () => {
  const { client, categories, requests } = fixture();
  await assert.rejects(
    changeCategoryParent(client, { ...Detach, parentId: "child" }),
    /different/u
  );
  Object.assign(categories.parent ?? {}, { parentCategoryId: "child" });
  await assert.rejects(changeCategoryParent(client, Detach), /one level/u);
  Reflect.deleteProperty(categories.parent ?? {}, "parentCategoryId");
  Reflect.deleteProperty(categories.child ?? {}, "parentCategoryId");
  Object.assign(categories.sibling ?? {}, { parentCategoryId: "child" });
  await assert.rejects(changeCategoryParent(client, Attach), /children/u);
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test("hierarchy writes reject missing orders and collisions instead of inventing or rewriting order", async () => {
  const { client, categories } = fixture();
  Object.assign(categories.unrelated ?? {}, { order: 1 });
  await assert.rejects(changeCategoryParent(client, Detach), /order/u);
  Object.assign(categories.unrelated ?? {}, { order: 3 });
  Reflect.deleteProperty(categories.child ?? {}, "order");
  await assert.rejects(changeCategoryParent(client, Detach), /order/u);
  Object.assign(categories.child ?? {}, { order: 2 });
  Reflect.deleteProperty(categories.child ?? {}, "parentCategoryId");
  await assert.rejects(changeCategoryParent(client, Attach), /order/u);
});

test("foreign-group children cannot hide a subtree or inconsistent parent family", async () => {
  const { client, categories, requests } = fixture();
  Object.assign(categories.sibling ?? {}, { groupId: "otherGroup" });
  await assert.rejects(changeCategoryParent(client, Detach), /same group/u);
  Object.assign(categories.sibling ?? {}, { parentCategoryId: "child" });
  Reflect.deleteProperty(categories.child ?? {}, "parentCategoryId");
  await assert.rejects(changeCategoryParent(client, Attach), /children|same group/u);
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test("a live hierarchy write binds all reads to its optimistic transaction and never retries a conflict", async () => {
  const { client, requests, setConflict } = fixture();
  setConflict();
  await assert.rejects(changeCategoryParent(client, Detach), /ABORTED/u);
  const commits = requests.filter((r) => r.path.endsWith(":commit"));
  expect(commits).toHaveLength(1);
  expect(commits[0]?.body.transaction).toBe("hierarchy-snapshot");
  expect(
    requests.some((r) => r.path.includes("/periods/") || r.path.includes("/transactions/"))
  ).toBe(false);
});

test("marker existence cannot confirm the requested hierarchy change", async () => {
  const { client, requests, setMarkerOnly } = fixture();
  setMarkerOnly();
  await assert.rejects(changeCategoryParent(client, Detach), /marker-only confirmation/u);
  expect(requests.filter((r) => r.path.endsWith(":commit"))).toHaveLength(1);
});

test("CLI attach and detach expose full native writes with explicit parent intent", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bebu-hierarchy-cli-"));
  const previousHome = process.env.BEBU_HOME;
  const previousSession = process.env.BEBU_SESSION_FILE;
  const { client, categories, fetcher, requests } = fixture();

  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fetcher, { preconnect: fetch.preconnect })
  );

  process.env.BEBU_HOME = directory;
  process.env.BEBU_SESSION_FILE = path.join(directory, "session.json");

  try {
    await writeFile(process.env.BEBU_SESSION_FILE, JSON.stringify(client.session));

    for (const action of ["detach", "attach"]) {
      if (action === "attach") {
        Reflect.deleteProperty(categories.child ?? {}, "parentCategoryId");
      }

      const result = await captureExecute(createApp(), [
        "categories",
        action,
        "child",
        "--parent",
        "parent",
        "--budget",
        "hierarchyLab",
        "--dry-run",
        "--full",
        "--compact",
      ]);

      assert.equal(result.exitCode, 0, result.stderr);
      expect(JSON.parse(result.stdout)).toMatchObject({
        dryRun: true,
        summary: { categoryId: "child", directFundingChanges: false },
      });
    }

    const missingParent = await captureExecute(createApp(), [
      "categories",
      "detach",
      "child",
      "--budget",
      "hierarchyLab",
      "--dry-run",
    ]);

    expect(missingParent.exitCode).not.toBe(0);
    expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
  } finally {
    fetchMock.mockRestore();

    if (previousHome === undefined) {
      Reflect.deleteProperty(process.env, "BEBU_HOME");
    } else {
      process.env.BEBU_HOME = previousHome;
    }

    if (previousSession === undefined) {
      Reflect.deleteProperty(process.env, "BEBU_SESSION_FILE");
    } else {
      process.env.BEBU_SESSION_FILE = previousSession;
    }

    await rm(directory, { force: true, recursive: true });
  }
});
