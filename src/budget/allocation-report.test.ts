import { expect, test } from "bun:test";

import type { Session } from "../auth/session.ts";
import { BeyondClient } from "../firestore/client.ts";
import { encodeFields } from "../firestore/encoding.ts";
import { allocationReport } from "./allocation-report.ts";

const root = "projects/beyond-budget/databases/(default)/documents/budgets/report";

const session: Session = {
  budgetIds: ["report"],
  expiresAt: Date.now() + 60_000,
  idToken: "test",
  importedAt: "2026-10-01T00:00:00Z",
  projectId: "beyond-budget",
  stashes: [],
  uid: "test",
  version: 1,
};

test("allocation reports keep negative allocations in the total without inflating positive percentages", async () => {
  const documents = {
    [root]: {
      availablePeriods: { "2026-10": { id: "oct" } },
      stashIdentifiers: { GROUPS_AND_CATEGORIES: "cats" },
    },
    [`${root}/stashes/cats`]: {
      data: {
        categories: {
          food: { id: "food", nature: "ESSENTIAL", type: "DEFAULT" },
          rent: { id: "rent", nature: "ESSENTIAL", type: "DEFAULT" },
          reserve: { id: "reserve", nature: "SAVINGS", type: "DEFAULT" },
        },
      },
    },
    [`${root}/periods/oct`]: {
      balances: {
        food: { allocatedAmount: 200 },
        orphan: { allocatedAmount: 200 },
        rent: { allocatedAmount: 600 },
        reserve: { allocatedAmount: -300 },
      },
    },
  };

  const client = new BeyondClient(session, {
    fetcher: async (url, init) => {
      expect(init?.method).toBe("GET");
      const path = new URL(new Request(url).url).pathname.slice(4);
      const data = Object.entries(documents).find(([name]) => name === path)?.[1];

      if (!data) {
        throw new Error(`Missing fixture ${path}`);
      }

      return await Promise.resolve(
        Response.json({
          fields: encodeFields(data),
          name: path,
          updateTime: "2026-10-01T00:00:00Z",
        })
      );
    },
  });

  const result = await allocationReport(client, "2026-10");
  expect(result).toMatchObject({ allocatedAmount: 700, positiveAllocatedAmount: 1000 });
  expect(result.categories.map(({ id, percentage }) => ({ id, percentage }))).toEqual([
    { id: "food", percentage: 20 },
    { id: "rent", percentage: 60 },
    { id: "reserve", percentage: 0 },
    { id: "orphan", percentage: 20 },
  ]);
  expect(result.natures).toEqual([
    { allocatedAmount: 800, nature: "ESSENTIAL", percentage: 80 },
    { allocatedAmount: -300, nature: "SAVINGS", percentage: 0 },
    { allocatedAmount: 200, nature: null, percentage: 20 },
  ]);
});
