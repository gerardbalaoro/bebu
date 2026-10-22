import { expect, test } from "bun:test";

import { BeyondClient } from "../firestore/client.ts";
import { encodeFields } from "../firestore/encoding.ts";
import type { Data } from "../firestore/encoding.ts";
import { allocationAverages } from "./allocation-averages.ts";

test("allocation averages use saved prior months, exclude nonpositive values, and preserve orphan IDs", async () => {
  const path = "projects/beyond-budget/databases/(default)/documents/budgets/example";

  const documents = new Map<string, Data>([
    [
      path,
      {
        availablePeriods: {
          "2026-05": { id: "may" },
          "2026-06": { id: "june" },
          "2026-08": { id: "august" },
          "2026-09": { id: "september" },
          "2026-10": { id: "october" },
        },
        stashIdentifiers: {},
      },
    ],
    [
      `${path}/periods/september`,
      {
        balances: { food: { allocatedAmount: 101, spentAmount: 200 } },
        id: "september",
        yearMonth: "2026-09",
      },
    ],
    [
      `${path}/periods/august`,
      {
        balances: {
          food: { allocatedAmount: 202, spentAmount: 0 },
          orphan: { allocatedAmount: 500 },
        },
        id: "august",
        yearMonth: "2026-08",
      },
    ],
    [
      `${path}/periods/june`,
      {
        balances: { food: { allocatedAmount: -900, spentAmount: 301 } },
        id: "june",
        yearMonth: "2026-06",
      },
    ],
  ]);

  const requests: string[] = [];

  const client = new BeyondClient(
    {
      budgetIds: ["example"],
      expiresAt: Date.now() + 60_000,
      idToken: "synthetic",
      importedAt: "2026-10-01T00:00:00Z",
      projectId: "beyond-budget",
      stashes: [],
      uid: "reader",
      version: 1,
    },
    {
      fetcher: (input, init) => {
        if (init?.method !== "GET") {
          throw new Error("Averages attempted a write");
        }

        const requested = new URL(String(input)).pathname.slice(4);
        requests.push(requested);
        const data = documents.get(requested);

        return Promise.resolve(
          data
            ? Response.json({
                fields: encodeFields(data),
                name: requested,
                updateTime: "2026-10-01T00:00:00Z",
              })
            : Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 })
        );
      },
    }
  );

  const result = await allocationAverages(client, "2026-10", 3);
  expect(result.periods).toEqual([
    { periodId: "september", yearMonth: "2026-09" },
    { periodId: "august", yearMonth: "2026-08" },
    { periodId: "june", yearMonth: "2026-06" },
  ]);
  expect(result.categories).toEqual([
    {
      allocated: { amount: 151, positiveMonths: 2 },
      categoryId: "food",
      spent: { amount: 250, positiveMonths: 2 },
    },
    {
      allocated: { amount: 500, positiveMonths: 1 },
      categoryId: "orphan",
      spent: { amount: 0, positiveMonths: 0 },
    },
  ]);
  expect(requests).not.toContain(`${path}/periods/october`);
  expect(requests).not.toContain(`${path}/periods/may`);
  const single = await allocationAverages(client, "2026-10", 1);
  expect(single.categories).toEqual([
    {
      allocated: { amount: 101, positiveMonths: 1 },
      categoryId: "food",
      spent: { amount: 200, positiveMonths: 1 },
    },
  ]);
  documents.delete(`${path}/periods/august`);
  await expect(allocationAverages(client, "2026-10", 3)).rejects.toThrow("404");
});
