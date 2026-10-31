/* oxlint-disable no-await-in-loop -- Canonical lookups run sequentially to bound Firestore request concurrency. */
import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema } from "../firestore/encoding.ts";
import type { Data, FirestoreDocument } from "../firestore/encoding.ts";
import { ObjectIdSchema } from "./transaction-model.ts";

export interface AllocationHistoryOptions {
  yearMonth?: string;
  categoryId?: string;
  includeTransactions?: boolean;
}

interface TransactionAssociation {
  document: string;
  updateTime: string;
  matchedBy: ("mapKey" | "entryId")[];
  data: Data;
}

interface HistoryEntry {
  mapKey: string;
  entry: Data;
  transactions?: TransactionAssociation[];
}

const readTransaction = async (client: BeyondClient, id: string) => {
  try {
    return await client.document(`${client.budgetPath}/transactions/${id}`);
  } catch (error) {
    // BeyondClient exposes HTTP status in its error message, not as a typed property.
    if (error instanceof Error && error.message.startsWith("Firestore 404:")) {
      return null;
    }

    throw error;
  }
};

const associateTransactions = async (client: BeyondClient, entries: HistoryEntry[]) => {
  const documents = new Map<string, Promise<FirestoreDocument | null>>();

  for (const row of entries) {
    const candidates = new Set([row.mapKey, row.entry.id]);
    const transactions: TransactionAssociation[] = [];

    for (const candidate of candidates) {
      const id = ObjectIdSchema.safeParse(candidate);

      if (!id.success) {
        continue;
      }

      let pending = documents.get(id.data);

      if (!pending) {
        pending = readTransaction(client, id.data);
        documents.set(id.data, pending);
      }

      const document = await pending;

      if (!document || document.data.id !== id.data) {
        continue;
      }

      const matchedBy: TransactionAssociation["matchedBy"] = [];

      if (row.mapKey === id.data) {
        matchedBy.push("mapKey");
      }

      if (row.entry.id === id.data) {
        matchedBy.push("entryId");
      }

      transactions.push({
        data: document.data,
        document: document.name,
        matchedBy,
        updateTime: document.updateTime,
      });
    }

    row.transactions = transactions;
  }
};

// Rows use ascending UTF-16 map-key order, independent of timestamps and native source semantics.
// Month filters use availablePeriods IDs; category filters match either observed category field.
export const allocationHistory = async (
  client: BeyondClient,
  options: AllocationHistoryOptions = {}
) => {
  const { yearMonth, categoryId, includeTransactions = false } = options;

  if (yearMonth !== undefined && !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(yearMonth)) {
    throw new Error("Use a month in YYYY-MM format");
  }

  if (categoryId !== undefined) {
    ObjectIdSchema.parse(categoryId);
  }

  const budget = await client.discover();

  const periodId =
    yearMonth === undefined ? undefined : budget.data.availablePeriods[yearMonth]?.id;

  if (yearMonth !== undefined && (periodId === undefined || periodId === "")) {
    throw new Error(`Budget period ${yearMonth} does not exist. Select an existing month`);
  }

  const history = z
    .record(z.string(), DataSchema)
    .parse(budget.data.allocationHistory === undefined ? {} : budget.data.allocationHistory);

  const entries: HistoryEntry[] = [];

  for (const mapKey of Object.keys(history).toSorted()) {
    const entry = history[mapKey];

    if (!entry || (periodId !== undefined && entry.periodId !== periodId)) {
      continue;
    }

    if (
      categoryId !== undefined &&
      entry.categoryId !== categoryId &&
      entry.linkedCategoryId !== categoryId
    ) {
      continue;
    }

    entries.push({ entry, mapKey });
  }

  if (includeTransactions) {
    await associateTransactions(client, entries);
  }

  return {
    budgetId: client.budgetId,
    entries,
    ordering: "mapKeyAscending" as const,
    periodId,
    source: { document: budget.name, updateTime: budget.updateTime },
    yearMonth,
  };
};
