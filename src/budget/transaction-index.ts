/* oxlint-disable no-await-in-loop -- Plan each index mutation against its captured snapshot. */
import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema, fieldPath } from "../firestore/encoding.ts";
import type { Data } from "../firestore/encoding.ts";
import type { Transaction } from "./transaction-model.ts";
import type { MutationPlan, TransactionContext } from "./transactions.ts";

const hasPreview = (record: Data, bucket: string, id: string) => {
  const data = DataSchema.parse(record.data ?? {});
  const transactions = DataSchema.parse(data[bucket] ?? {});

  return transactions[id] !== undefined;
};

const seriesPreview = (transaction: Transaction) => {
  const occurrence = transaction.occurrenceChange;

  const seriesAmount =
    occurrence?.amount === transaction.amount &&
    occurrence.seriesAmount !== null &&
    Math.sign(occurrence.seriesAmount) === Math.sign(transaction.amount)
      ? occurrence.seriesAmount
      : null;

  const occurrenceDate = occurrence?.dueAt ?? null;
  const seriesDate = occurrence?.seriesAnchorAt ?? null;

  const seriesAnchorAt =
    occurrenceDate !== null &&
    seriesDate !== null &&
    new Date(occurrenceDate).getTime() === new Date(transaction.dueAt).getTime()
      ? new Date(seriesDate)
      : null;

  return { seriesAmount, seriesAnchorAt };
};

export const transactionPreview = (transaction: Transaction): Data => {
  const keys = [
    "id",
    "amount",
    "anchorDay",
    "autoAllocateIfIncome",
    "cleared",
    "clonedToTransactionId",
    "color",
    "completed",
    "externalId",
    "frequency",
    "latitude",
    "longitude",
    "nonWorkingDayPolicy",
    "notes",
    "offsetAdjustment",
    "reconciled",
    "reconciledAt",
    "reminderEnabled",
    "repeatCount",
    "sentiment",
    "sequenceCount",
    "splitId",
    "subType",
    "tagIds",
    "type",
    "integrityCount",
  ];

  const result = Object.fromEntries(keys.map((k) => [k, transaction[k] ?? null]));
  result.dueAt = new Date(transaction.dueAt);
  result.createdByUserId = transaction.createdBy.uid;
  result.targetFromId = transaction.targetFrom?.id ?? null;
  result.targetToId = transaction.targetTo?.id ?? null;
  result.payeeId = transaction.payee?.id ?? null;
  result.extraTargetId = transaction.extraTarget?.id ?? null;
  result.hasFiles = !!transaction.files?.length;
  result.hasAutoAllocated = Boolean(transaction.extras.autoAllocated);

  if (
    transaction.reconciledAt !== undefined &&
    transaction.reconciledAt !== null &&
    transaction.reconciledAt !== ""
  ) {
    result.reconciledAt = new Date(transaction.reconciledAt);
  }

  if (!transaction.completed) {
    result.editable = transaction.editable;
  }

  return { ...result, ...seriesPreview(transaction) };
};

export const transactionIndexPaths = (client: BeyondClient, transaction: Transaction): string[] => {
  const ids = [
    client.stashId("TRANSACTIONS"),
    transaction.periodId,
    transaction.targetFrom?.id,
    transaction.targetTo?.id,
    transaction.payee?.id,
    ...transaction.tagIds,
  ].filter((candidate): candidate is string => typeof candidate === "string");

  return [...new Set(ids)].map((id) => `${client.budgetPath}/stashes/${id}`);
};

export const updateTransactionIndexes = async (
  plan: MutationPlan,
  before: Transaction,
  after: Transaction,
  context: TransactionContext
) => {
  const oldPaths = new Set(transactionIndexPaths(plan.client, before));
  const newPaths = new Set(transactionIndexPaths(plan.client, after));
  const bucket = before.completed ? "completedTransactions" : "upcomingTransactions";
  const oldPreview = transactionPreview(before);
  const newPreview = transactionPreview(after);

  const fields = Object.keys(newPreview).filter(
    (key) => JSON.stringify(oldPreview[key]) !== JSON.stringify(newPreview[key])
  );

  for (const path of new Set([...oldPaths, ...newPaths])) {
    const entry = await plan.entry(path);
    const exists = hasPreview(entry.doc.data, bucket, before.id);

    if (oldPaths.has(path) && newPaths.has(path)) {
      if (!exists) {
        continue;
      }

      for (const key of fields) {
        await plan.set(path, ["data", bucket, before.id, key], newPreview[key]);
      }

      continue;
    }

    const direction = newPaths.has(path) ? 1 : -1;

    if (direction > 0 || exists) {
      await plan.set(path, ["data", bucket, before.id], direction > 0 ? newPreview : undefined);
    }

    if (
      before.completed &&
      path !== `${plan.client.budgetPath}/stashes/${before.periodId}` &&
      path !== `${plan.client.budgetPath}/stashes/${after.periodId}`
    ) {
      await plan.increment(path, ["data", "completedTransactionCount"], direction);
    }
  }

  const counters = (transaction: Transaction) => {
    const entries: { name: string; path: string[] }[] = [];

    for (const target of [transaction.targetFrom, transaction.targetTo]) {
      if (target?.type === "CATEGORY") {
        entries.push({
          name: context.categories.name,
          path: ["data", "categories", target.id, "transactionCount"],
        });
      } else if (target) {
        entries.push({
          name: context.accounts.name,
          path: ["data", target.id, "transactionCount"],
        });
      }
    }

    if (transaction.payee) {
      entries.push({
        name: `${plan.client.budgetPath}/stashes/${plan.client.stashId("PAYEES")}`,
        path: ["data", transaction.payee.id, "transactionCount"],
      });
    }

    for (const id of transaction.tagIds) {
      entries.push({
        name: `${plan.client.budgetPath}/stashes/${plan.client.stashId("TAGS")}`,
        path: ["data", id, "transactionCount"],
      });
    }

    return entries;
  };

  const oldCounters = new Map(
    counters(before).map((entry) => [`${entry.name}/${fieldPath(...entry.path)}`, entry])
  );

  const newCounters = new Map(
    counters(after).map((entry) => [`${entry.name}/${fieldPath(...entry.path)}`, entry])
  );

  for (const [key, entry] of oldCounters) {
    if (!newCounters.has(key)) {
      await plan.increment(entry.name, entry.path, -1);
    }
  }

  for (const [key, entry] of newCounters) {
    if (!oldCounters.has(key)) {
      await plan.increment(entry.name, entry.path, 1);
    }
  }
};
