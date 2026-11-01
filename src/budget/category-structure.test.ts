/* oxlint-disable func-style, no-await-in-loop -- Named fixtures and ordered CLI observations keep lifecycle assertions independent. */
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
import { StructureService } from "./category-structure.ts";
import { removeCategoryTarget } from "./target-removal.ts";
import { TransactionOperations } from "./transaction-operations.ts";

const BudgetPath = `${DocumentRoot}/budgets/structureLab`;
const IndexPath = `${BudgetPath}/stashes/structureIndex`;
const Timestamp = "2026-11-01T00:00:00Z";

const MonthlySpendingTarget = {
  amount: 125,
  carryOverStrategy: "NONE",
  createdAt: Timestamp,
  dayOfMonth: null,
  dayOfWeek: null,
  dynamicSavingsTarget: false,
  endAt: null,
  monthOfYear: null,
  period: "MONTHLY",
  repeatIntervalMonths: null,
  snoozeSchedule: {},
  type: "SPENDING",
  useAllocatedAmountOnly: null,
};

function fixture() {
  const index = {
    data: {
      categories: {
        leisure: {
          carryOverStrategy: "ALL",
          groupId: "needs",
          id: "leisure",
          linkedAccountIds: [],
          modifiable: true,
          name: "Leisure",
          type: "DEFAULT",
          unknownSetting: "preserve",
        },
      },
      groups: { needs: { id: "needs", modifiable: true, name: "Needs", type: "DEFAULT" } },
    },
  };

  const requests: { path: string; body: ReturnType<typeof DataSchema.parse> }[] = [];
  let conflict = false;
  let markerOnly = false;

  const fetcher: Fetcher = async (input, init) => {
    const path = new URL(new Request(input).url).pathname.slice(4);

    const body =
      init?.body === undefined || init.body === null
        ? {}
        : DataSchema.parse(JSON.parse(z.string().parse(init.body)));

    requests.push({ body, path });

    if (path.endsWith(":beginTransaction")) {
      return await Promise.resolve(Response.json({ transaction: "structure-snapshot" }));
    }

    if (path.endsWith(":rollback")) {
      return await Promise.resolve(Response.json({}));
    }

    if (path.endsWith(":batchGet")) {
      const documents = z.array(z.string()).parse(body.documents);

      return await Promise.resolve(
        Response.json(
          documents.map((name) => {
            const data =
              name === BudgetPath
                ? {
                    availablePeriods: {},
                    stashIdentifiers: { GROUPS_AND_CATEGORIES: "structureIndex" },
                  }
                : index;

            return { found: { fields: encodeFields(data), name, updateTime: Timestamp } };
          })
        )
      );
    }

    if (path.endsWith(":commit")) {
      if (conflict) {
        return await Promise.resolve(
          Response.json({ error: { message: "changed", status: "ABORTED" } }, { status: 409 })
        );
      }

      return await Promise.resolve(Response.json({ commitTime: Timestamp }));
    }

    if (path.includes("/saveMarkers/")) {
      if (markerOnly) {
        return await Promise.resolve(
          Response.json({
            fields: encodeFields({ createdAt: Timestamp }),
            name: path,
            updateTime: Timestamp,
          })
        );
      }

      return await Promise.resolve(
        Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 })
      );
    }

    if (init?.method === "GET" && (path === BudgetPath || path === IndexPath)) {
      const data =
        path === BudgetPath
          ? { availablePeriods: {}, stashIdentifiers: { GROUPS_AND_CATEGORIES: "structureIndex" } }
          : index;

      return await Promise.resolve(
        Response.json({ fields: encodeFields(data), name: path, updateTime: Timestamp })
      );
    }

    throw new Error(`Unexpected structure request ${path}`);
  };

  const client = new BeyondClient(
    {
      budgetIds: ["structureLab"],
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
    fetcher,
    index,
    requests,
    service: new StructureService(client),
    setConflict: () => {
      conflict = true;
    },
    setMarkerOnly: () => {
      conflict = true;
      markerOnly = true;
    },
  };
}

test.each(["category", "group"] as const)(
  "%s rename patches only the native name field under its snapshot version",
  async (kind) => {
    const { service, index, requests } = fixture();
    const original = structuredClone(index);
    const id = kind === "category" ? "leisure" : "needs";
    const result = await service.rename(kind, id, "New Name", { dryRun: true });
    assert.ok("dryRun" in result);
    const [write] = result.body.writes;
    expect(write).toEqual({
      currentDocument: { updateTime: Timestamp },
      update: {
        fields: encodeFields({
          data: { [kind === "category" ? "categories" : "groups"]: { [id]: { name: "New Name" } } },
        }),
        name: IndexPath,
      },
      updateMask: {
        fieldPaths: [`data.${kind === "category" ? "categories" : "groups"}.${id}.name`],
      },
    });
    expect(result.summary).toMatchObject({
      financialChanges: false,
      id,
      kind,
      name: { after: "New Name" },
    });
    expect(requests[0]?.body).toEqual({ options: { readOnly: {} } });
    expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
    expect(index).toEqual(original);
  }
);

test("a live rename protects dependencies in one atomic transaction and never retries conflicts", async () => {
  const { service, requests, setConflict } = fixture();
  setConflict();
  await assert.rejects(service.rename("category", "leisure", "Changed"), /ABORTED/u);
  const commits = requests.filter((r) => r.path.endsWith(":commit"));
  expect(commits).toHaveLength(1);
  expect(commits[0]?.body.transaction).toBe("structure-snapshot");
  expect(requests.at(-1)?.path).toContain("/saveMarkers/");
});

test("unknown membership, identity, and modification eligibility cannot produce a rename", async () => {
  const { service, index, requests } = fixture();
  await assert.rejects(service.rename("category", "missing", "Changed"), /not found/u);
  index.data.categories.leisure.id = "different";
  await assert.rejects(service.rename("category", "leisure", "Changed"), /identity/u);
  index.data.categories.leisure.id = "leisure";
  index.data.categories.leisure.modifiable = false;
  await assert.rejects(service.rename("category", "leisure", "Changed"), /modifiable/u);
  await assert.rejects(service.rename("group", "needs", "   "), /small/u);
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test("an unchanged name is reported without a financial commit or marker", async () => {
  const { service, requests } = fixture();
  expect(await service.rename("category", "leisure", "Leisure")).toMatchObject({
    changed: false,
    committed: false,
  });
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test("a native marker without an acknowledgment cannot confirm the requested rename", async () => {
  const { service, index, requests, setMarkerOnly } = fixture();
  const original = structuredClone(index);
  setMarkerOnly();
  await assert.rejects(
    service.rename("category", "leisure", "Changed"),
    /marker-only confirmation/u
  );
  expect(requests.filter((r) => r.path.endsWith(":commit"))).toHaveLength(1);
  expect(index).toEqual(original);
});

test("target removal cannot retry or escape its snapshot on a concurrent change", async () => {
  const { service, index, requests, setConflict } = fixture();
  Object.assign(index.data.categories.leisure, { target: MonthlySpendingTarget });
  const original = structuredClone(index);
  setConflict();
  await assert.rejects(removeCategoryTarget(service.client, "leisure"), /ABORTED/u);
  const commits = requests.filter((r) => r.path.endsWith(":commit"));
  expect(commits).toHaveLength(1);
  expect(commits[0]?.body.transaction).toBe("structure-snapshot");
  expect(index).toEqual(original);
});

test("target removal deletes the whole native target field without changing funding or other configuration", async () => {
  const { service, index, requests } = fixture();

  const target = { ...MonthlySpendingTarget, unknownSetting: "preserve-in-preview" };

  Object.assign(index.data.categories.leisure, { target });
  const before = structuredClone(index);
  const result = await removeCategoryTarget(service.client, "leisure", { dryRun: true });
  assert.ok("dryRun" in result);
  expect(result.body.writes[0]).toEqual({
    currentDocument: { updateTime: Timestamp },
    update: { fields: encodeFields({ data: { categories: { leisure: {} } } }), name: IndexPath },
    updateMask: { fieldPaths: ["data.categories.leisure.target"] },
  });
  expect(result.summary).toMatchObject({
    directFundingChanges: false,
    futureTargetDemand: "removed",
    previousTarget: target,
  });
  expect(index).toEqual(before);
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test("unsupported targets and hierarchical categories cannot use the removal subset", async () => {
  const { service, index, requests } = fixture();
  Object.assign(index.data.categories.leisure, {
    target: { amount: 125, period: "MONTHLY", type: "SAVINGS" },
  });
  await assert.rejects(removeCategoryTarget(service.client, "leisure"), /monthly spending/u);
  Object.assign(index.data.categories.leisure, {
    parentCategoryId: "parent",
    target: { amount: 125, period: "MONTHLY", type: "SPENDING" },
  });
  await assert.rejects(removeCategoryTarget(service.client, "leisure"), /flat ordinary/u);
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test.each([undefined, ["savingsAccount"]])(
  "target removal preserves raw links %j without deriving financial defaults",
  async (linkedAccountIds) => {
    const { service, index } = fixture();
    Object.assign(index.data.categories.leisure, { target: MonthlySpendingTarget });

    if (linkedAccountIds === undefined) {
      Reflect.deleteProperty(index.data.categories.leisure, "linkedAccountIds");
    } else {
      Object.assign(index.data.categories.leisure, { linkedAccountIds });
    }

    const before = structuredClone(index);
    const result = await removeCategoryTarget(service.client, "leisure", { dryRun: true });
    assert.ok("dryRun" in result);
    expect(result.body.writes[0]?.updateMask?.fieldPaths).toEqual([
      "data.categories.leisure.target",
    ]);
    expect(index).toEqual(before);
  }
);

test.each([
  { repeatIntervalMonths: 1 },
  { snoozeSchedule: { "2026-12": true } },
  { endAt: Timestamp },
])("target removal does not infer missing or inactive schedules from %j", async (settings) => {
  const { service, index, requests } = fixture();
  Object.assign(index.data.categories.leisure, {
    target: { ...MonthlySpendingTarget, ...settings },
  });
  await assert.rejects(removeCategoryTarget(service.client, "leisure"), /monthly spending/u);
  expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
});

test("CLI rename, group lookup, and durable recovery routes expose the domain results", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-structure-cli-"));
  const previousHome = process.env.BEBU_HOME;
  const previousSession = process.env.BEBU_SESSION_FILE;
  const { service, index, fetcher, requests } = fixture();

  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fetcher, { preconnect: fetch.preconnect })
  );

  process.env.BEBU_HOME = directory;
  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    await writeFile(process.env.BEBU_SESSION_FILE, JSON.stringify(service.client.session));

    const preview = await captureExecute(createApp(), [
      "categories",
      "rename",
      "leisure",
      "--name",
      "Renamed",
      "--budget",
      "structureLab",
      "--dry-run",
      "--full",
      "--compact",
    ]);

    expect(preview.exitCode).toBe(0);
    expect(JSON.parse(preview.stdout)).toMatchObject({
      dryRun: true,
      summary: { financialChanges: false, name: { after: "Renamed", before: "Leisure" } },
    });

    const groups = await captureExecute(createApp(), [
      "groups",
      "list",
      "--budget",
      "structureLab",
      "--compact",
    ]);

    expect(groups.exitCode).toBe(0);
    expect(JSON.parse(groups.stdout)).toEqual([
      { id: "needs", modifiable: true, name: "Needs", type: "DEFAULT" },
    ]);

    const groupRename = await captureExecute(createApp(), [
      "groups",
      "rename",
      "needs",
      "--name",
      "Renamed",
      "--budget",
      "structureLab",
      "--dry-run",
      "--compact",
    ]);

    expect(groupRename.exitCode).toBe(0);
    expect(JSON.parse(groupRename.stdout)).toMatchObject({
      summary: { kind: "group", name: { after: "Renamed" } },
    });
    Object.assign(index.data.categories.leisure, { target: MonthlySpendingTarget });

    const removal = await captureExecute(createApp(), [
      "targets",
      "remove",
      "leisure",
      "--budget",
      "structureLab",
      "--dry-run",
      "--compact",
    ]);

    expect(removal.exitCode).toBe(0);
    expect(JSON.parse(removal.stdout)).toMatchObject({
      dryRun: true,
      summary: { directFundingChanges: false, futureTargetDemand: "removed" },
    });
    expect(requests.some((r) => r.path.endsWith(":commit"))).toBe(false);
    const operations = new TransactionOperations(service.client, { home: directory });
    const requestId = "ABCDEFGHIJKLMNOPQRST";
    await operations.run(
      { action: "delete", input: {}, transactionId: "expense" },
      { requestId },
      async (options) =>
        await operations.commit(
          [{ currentDocument: { exists: true }, delete: `${BudgetPath}/transactions/expense` }],
          options
        )
    );
    const count = requests.filter((r) => r.path.endsWith(":commit")).length;

    for (const action of ["operation", "recover"]) {
      const result = await captureExecute(createApp(), [
        "transactions",
        action,
        requestId,
        "--budget",
        "structureLab",
        "--compact",
      ]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject(
        action === "operation"
          ? { state: { status: "committed" } }
          : { financialRetryMade: false, status: "committed" }
      );
    }

    expect(requests.filter((r) => r.path.endsWith(":commit"))).toHaveLength(count);
  } finally {
    fetchMock.mockRestore();

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

    await rm(directory, { force: true, recursive: true });
  }
});
