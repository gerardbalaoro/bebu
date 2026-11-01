/* oxlint-disable func-style, no-await-in-loop -- Named fixtures exercise the read-only workflow and its exact patch. */
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
import { previewCategoryGroupMove } from "./category-group.ts";

const BudgetPath = `${DocumentRoot}/budgets/groupMoveLab`;
const IndexPath = `${BudgetPath}/stashes/categories`;
const Timestamp = "2026-11-02T00:00:00Z";
const Input = { categoryId: "source", fromGroupId: "old", groupId: "next" };

function fixture() {
  const category = { modifiable: true, name: "Category", type: "DEFAULT" };

  const budget = {
    availablePeriods: {},
    id: "groupMoveLab",
    stashIdentifiers: { GROUPS_AND_CATEGORIES: "categories" },
    type: "ZERO_BASED",
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

  const fetcher: Fetcher = async (input, init) => {
    const path = new URL(new Request(input).url).pathname.slice(4);
    const body = DataSchema.parse(await new Response(init?.body).json());
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
            assert.ok(name === BudgetPath || name === IndexPath);

            return {
              found: {
                fields: encodeFields(name === BudgetPath ? budget : index),
                name,
                updateTime: Timestamp,
              },
            };
          })
      );
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

  return { budget, client, fetcher, index, requests };
}

test("group move preview appends after the highest destination order and patches only membership and order", async () => {
  const { client, index, requests } = fixture();
  const before = structuredClone(index);
  const result = await previewCategoryGroupMove(client, Input);
  assert.ok("body" in result);
  expect(result.summary).toMatchObject({
    executionSupported: false,
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
    await assert.rejects(previewCategoryGroupMove(client, Input));
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
    await assert.rejects(previewCategoryGroupMove(f.client, Input));
  }
});

test("group move preview rejects reverse direction and missing group order instead of inferring native placement", async () => {
  for (const value of [undefined, 0, 1]) {
    const { client, index } = fixture();
    const destination = index.data.groups.next;
    assert.ok(destination);
    destination.order = value;
    await assert.rejects(previewCategoryGroupMove(client, Input));
  }
});

test("category group move without dry-run stops before auth or network access", async () => {
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
    "--compact",
  ]);

  expect(result.exitCode).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("lab validation");
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
          executionSupported: z.literal(false),
          groupId: z.object({ after: z.string(), before: z.string() }),
        }),
      })
      .parse(JSON.parse(result.stdout));

    expect(value.summary.groupId).toEqual({ after: "next", before: "old" });
    expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);

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
