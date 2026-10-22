import { expect, test } from "bun:test";

import type { Session } from "../auth/session.ts";
import { BeyondClient } from "../firestore/client.ts";
import { encodeFields } from "../firestore/encoding.ts";
import type { Data, DecodedValue } from "../firestore/encoding.ts";
import { allocationHistory } from "./allocation-history.ts";

const budgetPath = "projects/beyond-budget/databases/(default)/documents/budgets/historyFixture";
const timestamp = "2026-10-01T00:00:00.000Z";

const fixture = (history: DecodedValue = {}) => {
  const session: Session = {
    budgetIds: ["historyFixture"],
    expiresAt: Date.now() + 3_600_000,
    idToken: "synthetic-token",
    importedAt: timestamp,
    projectId: "beyond-budget",
    stashes: [],
    uid: "synthetic-user",
    version: 1,
  };

  const budget: Data = {
    allocationHistory: history,
    availablePeriods: { "2026-10": { id: "october" }, "2026-11": { id: "november" } },
    stashIdentifiers: {},
  };

  const documents = new Map<string, Data>([[budgetPath, budget]]);
  const requests: string[] = [];
  const failures = new Map<string, number>();

  const client = new BeyondClient(session, {
    fetcher: (input, init) => {
      const path = new URL(String(input)).pathname.slice(4);
      requests.push(path);

      if (init?.method !== "GET") {
        throw new Error("Read-only history attempted a write");
      }

      const data = documents.get(path);
      const status = failures.get(path) ?? (data ? 200 : 404);

      return Promise.resolve(
        status === 200
          ? Response.json({ fields: encodeFields(data ?? {}), name: path, updateTime: timestamp })
          : Response.json(
              { error: { message: "Fixture error", status: "FIXTURE_ERROR" } },
              { status }
            )
      );
    },
  });

  return { budget, client, documents, failures, requests };
};

test("history keeps map keys distinct from empty IDs, unknown sources and raw fields in stable key order", async () => {
  const history = {
    aRow: { beforeAmount: -3, id: "differentId", source: "MANUAL", undoneAt: "unknown" },
    zRow: { accountId: "", extra: { unknown: true }, id: "", source: "FUTURE_SOURCE" },
  };

  const { client, requests } = fixture(Object.fromEntries(Object.entries(history).toReversed()));

  expect(await allocationHistory(client)).toEqual({
    budgetId: "historyFixture",
    entries: [
      {
        entry: { beforeAmount: -3, id: "differentId", source: "MANUAL", undoneAt: "unknown" },
        mapKey: "aRow",
      },
      {
        entry: { accountId: "", extra: { unknown: true }, id: "", source: "FUTURE_SOURCE" },
        mapKey: "zRow",
      },
    ],
    ordering: "mapKeyAscending",
    periodId: undefined,
    source: { document: budgetPath, updateTime: timestamp },
    yearMonth: undefined,
  });
  expect(requests).toEqual([budgetPath]);
});

test("month follows period IDs, and category filtering includes the linked category without inferring from timestamps", async () => {
  const { client, requests } = fixture({
    a: { categoryId: "food", createdAt: "2026-11-01", id: "", periodId: "october" },
    b: { id: "", linkedCategoryId: "food", periodId: "october" },
    c: { categoryId: "food", createdAt: "2026-10-01", id: "", periodId: "november" },
    d: { categoryId: "other", id: "", periodId: "october" },
    e: { categoryId: "food", id: "", periodId: "" },
  });

  const result = await allocationHistory(client, { categoryId: "food", yearMonth: "2026-10" });
  expect(result.entries.map((entry) => entry.mapKey)).toEqual(["a", "b"]);
  expect(result).toMatchObject({ periodId: "october", yearMonth: "2026-10" });
  expect(requests).toEqual([budgetPath]);
});

test("canonical associations match both candidate IDs, deduplicate lookups, and retain unmatched history", async () => {
  const { client, documents, requests } = fixture({
    mapId: { id: "entryId", source: "UNRECOGNIZED" },
    repeated: { id: "entryId" },
    sameId: { id: "sameId" },
    unmatched: { id: "" },
  });

  documents.set(`${budgetPath}/transactions/mapId`, {
    extras: {},
    id: "mapId",
    type: "REALLOCATE_MONEY",
  });
  documents.set(`${budgetPath}/transactions/entryId`, {
    extras: {},
    id: "entryId",
    type: "INFLOW",
  });
  documents.set(`${budgetPath}/transactions/sameId`, {
    extras: {},
    id: "sameId",
    type: "FUTURE_TYPE",
  });
  const result = await allocationHistory(client, { includeTransactions: true });
  expect(result.entries[0]).toEqual({
    entry: { id: "entryId", source: "UNRECOGNIZED" },
    mapKey: "mapId",
    transactions: [
      {
        data: { extras: {}, id: "mapId", type: "REALLOCATE_MONEY" },
        document: `${budgetPath}/transactions/mapId`,
        matchedBy: ["mapKey"],
        updateTime: timestamp,
      },
      {
        data: { extras: {}, id: "entryId", type: "INFLOW" },
        document: `${budgetPath}/transactions/entryId`,
        matchedBy: ["entryId"],
        updateTime: timestamp,
      },
    ],
  });
  expect(result.entries[2]?.transactions?.[0]?.matchedBy).toEqual(["mapKey", "entryId"]);
  expect(result.entries[3]).toMatchObject({ mapKey: "unmatched", transactions: [] });
  expect(requests.filter((path) => path.endsWith("/entryId"))).toHaveLength(1);
  expect(requests).not.toContain(`${budgetPath}/transactions/`);
});

test("unsafe raw history identifiers are preserved but never used as request paths", async () => {
  const { client, requests } = fixture({ "../escape": { id: "bad/path", source: null } });
  const result = await allocationHistory(client, { includeTransactions: true });
  expect(result.entries).toEqual([
    { entry: { id: "bad/path", source: null }, mapKey: "../escape", transactions: [] },
  ]);
  expect(requests).toEqual([budgetPath]);
});

test("a canonical document with a different stored ID is not reported as a match", async () => {
  const { client, documents } = fixture({ row: { id: "" } });
  documents.set(`${budgetPath}/transactions/row`, { id: "different" });
  const result = await allocationHistory(client, { includeTransactions: true });
  expect(result.entries[0]?.transactions).toEqual([]);
});

test.each([403, 500])(
  "canonical lookup HTTP %s is propagated instead of called an unmatched entry",
  async (status) => {
    const { client, failures } = fixture({ row: { id: "" } });
    failures.set(`${budgetPath}/transactions/row`, status);
    await expect(allocationHistory(client, { includeTransactions: true })).rejects.toThrow(
      `Firestore ${status}`
    );
  }
);

test("absent history is empty but malformed history and malformed entries fail", async () => {
  const absent = fixture();
  delete absent.budget.allocationHistory;
  const result = await allocationHistory(absent.client);
  expect(result.entries).toEqual([]);
  await Promise.all(
    [null, [], "invalid", { row: null }].map(async (malformed) => {
      await expect(allocationHistory(fixture(malformed).client)).rejects.toThrow();
    })
  );
});

test("invalid filters fail before reads and missing months never fall back to all history", async () => {
  const { client, requests } = fixture();
  await expect(allocationHistory(client, { yearMonth: "2026-13" })).rejects.toThrow();
  await expect(allocationHistory(client, { categoryId: "../food" })).rejects.toThrow();
  expect(requests).toEqual([]);
  await expect(allocationHistory(client, { yearMonth: "2027-01" })).rejects.toThrow(
    "does not exist"
  );
});
