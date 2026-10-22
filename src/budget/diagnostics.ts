import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema, DocumentRoot } from "../firestore/encoding.ts";
import type { Data } from "../firestore/encoding.ts";

interface ObservedField {
  document: string;
  path: string[];
  value: unknown;
}

// These names identify observed fields, not their owner or their native behavior.
const settingNames = new Set([
  "config",
  "autoAllocateIncomeEnabled",
  "surplusFundsCoverOverspendingByDefault",
  "overwriteCurrentAllocationEnabled",
  "allowPartialAllocationEnabled",
  "ignorePendingAllocationAmountEnabled",
  "saveAndAllocateEnabled",
  "autoReallocationPolicy",
  "accumulationStrategy",
  "carryOverStrategy",
  "aggregateAllocationForTarget",
  "isEligibleForTargetAllocation",
]);

const linkNames = new Set(["linkedAccountIds", "linkedCategoryId"]);

const observedFields = (
  document: string,
  data: Data,
  names: ReadonlySet<string>,
  path: string[] = []
): ObservedField[] =>
  Object.entries(data).flatMap(([key, value]) => {
    const fieldPath = [...path, key];

    if (names.has(key)) {
      return [{ document, path: fieldPath, value }];
    }

    const nested = DataSchema.safeParse(value);

    return nested.success ? observedFields(document, nested.data, names, fieldPath) : [];
  });

export const budgetDiagnostics = async (client: BeyondClient) => {
  const budget = await client.discover();

  const documents = [
    budget,
    ...(await Promise.all([
      client.document(`${DocumentRoot}/users/${client.session.uid}`),
      client.stash("ACCOUNTS"),
      client.stash("GROUPS_AND_CATEGORIES"),
    ])),
  ];

  return {
    budgetId: client.budgetId,
    links: documents.flatMap((doc) => observedFields(doc.name, doc.data, linkNames)),
    settings: documents.flatMap((doc) => observedFields(doc.name, doc.data, settingNames)),
    sources: documents.map((doc) => ({ document: doc.name, updateTime: doc.updateTime })),
  };
};
