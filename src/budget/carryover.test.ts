/* oxlint-disable func-style, no-await-in-loop -- Named fixture factories and ordered audit cases follow the repository conventions. */
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
import type { Data } from "../firestore/encoding.ts";
import { auditCarryover, categoryCarryover } from "./carryover.ts";

const categories = {
  leisure: { carryOverStrategy: "ALL", id: "leisure", linkedAccountIds: [], type: "DEFAULT" },
};

const periods = [
  {
    balances: {
      leisure: { allocatedAmount: 80, carriedOverAmount: 20, otherAmount: 10, spentAmount: 110 },
    },
    periodId: "july",
    yearMonth: "2025-07",
  },
  {
    balances: {
      leisure: { allocatedAmount: 0, carriedOverAmount: 12_500, otherAmount: 0, spentAmount: 0 },
    },
    periodId: "august",
    yearMonth: "2025-08",
  },
];

const [july, august] = periods;

assert.ok(july);

assert.ok(august);

test("a stored discontinuity is reported without declaring the baseline wrong or proposing repair", () => {
  const original = structuredClone(periods);
  const result = auditCarryover(categories, periods);
  expect(result).toMatchObject({
    comparisons: [
      {
        previousAvailableAmount: 0,
        residualAmount: 12_500,
        status: "discontinuity",
        storedCarriedOverAmount: 12_500,
      },
    ],
    executionSupported: false,
    historicalPolicyKnown: false,
    propagationVerified: false,
    readOnly: true,
    totals: { comparisons: 1, discontinuities: 1, unknown: 0 },
  });
  expect(periods).toEqual(original);
  const recalculated = structuredClone(periods);
  const [changedJuly, changedAugust] = recalculated;
  assert.ok(changedJuly);
  assert.ok(changedAugust);
  changedJuly.balances.leisure.carriedOverAmount = 39_500;
  changedAugust.balances.leisure.carriedOverAmount = 39_480;
  expect(auditCarryover(categories, recalculated)).toMatchObject({
    comparisons: [{ residualAmount: 0, status: "continuous" }],
    propagationVerified: false,
  });
});

test.each([
  {
    label: "missing amount",
    modify: { allocatedAmount: 80, carriedOverAmount: 20, spentAmount: 100 },
    reason: "unknown-or-unsafe-previous-otherAmount",
  },
  {
    label: "unsafe integer",
    modify: {
      allocatedAmount: Number.MAX_SAFE_INTEGER + 1,
      carriedOverAmount: 0,
      otherAmount: 0,
      spentAmount: 0,
    },
    reason: "unknown-or-unsafe-previous-allocatedAmount",
  },
  {
    label: "overflow",
    modify: {
      allocatedAmount: Number.MAX_SAFE_INTEGER,
      carriedOverAmount: 1,
      otherAmount: 0,
      spentAmount: 0,
    },
    reason: "unsafe-available-or-residual-amount",
  },
])("$label stays unknown instead of receiving a financial default", ({ modify, reason }) => {
  const result = auditCarryover(categories, [
    { balances: { leisure: modify }, periodId: "july", yearMonth: "2025-07" },
    august,
  ]);

  expect(result.comparisons[0]).toMatchObject({
    previousAvailableAmount: null,
    residualAmount: null,
    status: "unknown",
  });
  expect(result.comparisons[0]?.reasons).toContain(reason);
});

test("signed carryover and exact cancellation survive large intermediate sums", () => {
  const result = auditCarryover(categories, [
    {
      balances: {
        leisure: {
          allocatedAmount: Number.MAX_SAFE_INTEGER,
          carriedOverAmount: Number.MAX_SAFE_INTEGER,
          otherAmount: -Number.MAX_SAFE_INTEGER,
          spentAmount: Number.MAX_SAFE_INTEGER,
        },
      },
      periodId: "december",
      yearMonth: "2025-12",
    },
    {
      balances: { leisure: { carriedOverAmount: -50 } },
      periodId: "january",
      yearMonth: "2026-01",
    },
  ]);

  expect(result.comparisons[0]).toMatchObject({
    previousAvailableAmount: 0,
    residualAmount: -50,
    status: "discontinuity",
    storedCarriedOverAmount: -50,
  });
});

test.each([undefined, "NONE", "UNKNOWN"])(
  "current policy %s cannot establish historical continuity",
  (carryOverStrategy) => {
    const result = auditCarryover(
      { leisure: { ...categories.leisure, carryOverStrategy } },
      periods
    );

    expect(result.comparisons[0]?.status).toBe("unknown");
    expect(result.comparisons[0]?.reasons).toContain("current-policy-is-not-explicit-ALL");
  }
);

test("missing calendar months and reused period identities cannot look continuous", () => {
  const result = auditCarryover(categories, [july, { ...august, yearMonth: "2025-09" }]);
  expect(result.comparisons[0]?.reasons).toContain("missing-intermediate-month");
  expect(() => auditCarryover(categories, [july, { ...august, periodId: "july" }])).toThrow(
    "unique"
  );
});

test("a category identity mismatch cannot certify continuity", () => {
  const result = auditCarryover({ leisure: { ...categories.leisure, id: "different" } }, periods);
  expect(result.comparisons[0]).toMatchObject({
    reasons: ["category-identity-is-unknown-or-inconsistent"],
    residualAmount: null,
    status: "unknown",
  });
});

const path = `${DocumentRoot}/budgets/auditBudget`;
const timestamp = "2026-11-01T00:00:00Z";

const session = {
  budgetIds: ["auditBudget"],
  expiresAt: Date.now() + 3_600_000,
  idToken: "synthetic-token",
  importedAt: timestamp,
  projectId: "beyond-budget" as const,
  stashes: [],
  uid: "auditUser",
  version: 1 as const,
};

function fixture() {
  const documents = new Map<string, Data>([
    [
      path,
      {
        availablePeriods: { "2025-07": { id: "july" }, "2025-08": { id: "august" } },
        stashIdentifiers: { GROUPS_AND_CATEGORIES: "categoryIndex" },
      },
    ],
    [`${path}/stashes/categoryIndex`, { data: { categories } }],
    ...periods.map((period): [string, Data] => [
      `${path}/periods/${period.periodId}`,
      { ...period, id: period.periodId },
    ]),
  ]);

  const requests: { path: string; body: Data }[] = [];

  const wire = (name: string) => ({
    fields: encodeFields(documents.get(name) ?? {}),
    name,
    updateTime: timestamp,
  });

  const fetcher: Fetcher = async (input, init) => {
    const name = new URL(new Request(input).url).pathname.slice(4);

    const body =
      init?.body === undefined || init.body === null
        ? {}
        : DataSchema.parse(JSON.parse(z.string().parse(init.body)));

    requests.push({ body, path: name });

    if (name.endsWith(":beginTransaction")) {
      return await Promise.resolve(Response.json({ transaction: "audit-snapshot" }));
    }

    if (name.endsWith(":batchGet")) {
      expect(body.transaction).toBe("audit-snapshot");
      const names = z.array(z.string()).parse(body.documents);

      return await Promise.resolve(
        Response.json(
          names
            .toReversed()
            .map((documentPath) =>
              documents.has(documentPath)
                ? { found: wire(documentPath) }
                : { missing: documentPath }
            )
        )
      );
    }

    if (name.endsWith(":rollback")) {
      return await Promise.resolve(Response.json({}));
    }

    if (init?.method === "GET" && documents.has(name)) {
      return await Promise.resolve(Response.json(wire(name)));
    }

    throw new Error("Unexpected non-read request in carryover audit");
  };

  return {
    client: new BeyondClient(structuredClone(session), { fetcher }),
    documents,
    fetcher,
    requests,
  };
}

test("the audit reads one consistent snapshot, preserves versions, and never commits", async () => {
  const { client, documents, requests } = fixture();
  const before = structuredClone(documents);
  const result = await categoryCarryover(client, { categoryId: "leisure" });
  expect(result).toMatchObject({
    months: ["2025-07", "2025-08"],
    snapshotConsistent: true,
    totals: { discontinuities: 1 },
  });
  expect(result.sources).toHaveLength(4);
  expect(requests[0]?.body).toEqual({ options: { readOnly: {} } });
  expect(requests.at(-1)?.path).toEndWith(":rollback");
  expect(requests.some((request) => request.path.endsWith(":commit"))).toBe(false);
  expect(documents).toEqual(before);
});

test("missing period documents fail the audit and still release the read snapshot", async () => {
  const { client, documents, requests } = fixture();
  documents.delete(`${path}/periods/august`);
  await assert.rejects(categoryCarryover(client), /period is missing/u);
  expect(requests.at(-1)?.path).toEndWith(":rollback");
});

test("CLI carryover audits expose observations without acquiring a write transaction", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-carryover-cli-"));
  const previous = process.env.BEBU_SESSION_FILE;
  const { fetcher, requests } = fixture();

  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fetcher, { preconnect: fetch.preconnect })
  );

  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    await writeFile(process.env.BEBU_SESSION_FILE, JSON.stringify(session));

    const result = await captureExecute(createApp(), [
      "categories",
      "carryover",
      "--budget",
      "auditBudget",
      "--category",
      "leisure",
      "--from-month",
      "2025-07",
      "--through-month",
      "2025-08",
      "--compact",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      executionSupported: false,
      readOnly: true,
      totals: { discontinuities: 1 },
    });
    expect(requests.find((request) => request.path.endsWith(":beginTransaction"))?.body).toEqual({
      options: { readOnly: {} },
    });
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
