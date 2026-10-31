/* oxlint-disable func-style -- Named domain functions follow the repository TypeScript conventions. */
/* oxlint-disable no-await-in-loop -- Verify each canonical link and incoming edge in one database snapshot. */

import type { z } from "zod";

import { DataSchema } from "../firestore/encoding.ts";
import {
  TransactionDeleteScopeSchema,
  TransactionSchema,
  ObjectIdSchema,
} from "./transaction-model.ts";
import type { Transaction } from "./transaction-model.ts";
import type { MutationPlan, TransactionContext } from "./transactions.ts";

const MaxOccurrences = 100;

export async function removeTransactionReminder(
  plan: MutationPlan,
  transaction: Transaction,
  context: TransactionContext
) {
  const stashId = context.budget.data.stashIdentifiers.REMINDERS;

  if (stashId === undefined || stashId === "") {
    if (transaction.reminderEnabled) {
      throw new Error(
        "The reminder index is missing. Recurring deletion cannot safely remove its reminder"
      );
    }

    return;
  }

  ObjectIdSchema.parse(stashId);

  if (plan.snapshot === undefined) {
    throw new Error("Reminder deletion requires a consistent transaction snapshot");
  }

  const stashPath = `${plan.client.budgetPath}/stashes/${stashId}`;
  const { doc } = await plan.entry(stashPath);
  const reminders = DataSchema.parse(doc.data.data ?? {});

  if (reminders[transaction.id] !== undefined) {
    await plan.set(stashPath, ["data", transaction.id], undefined);
  }

  const reminderPath = `${plan.client.budgetPath}/reminders/${transaction.id}`;
  const documents = await plan.snapshot.read([reminderPath]);
  const reminder = documents.get(reminderPath);

  if (reminder !== undefined && reminder !== null) {
    plan.extra.push({
      currentDocument: { updateTime: reminder.updateTime },
      delete: reminder.name,
    });
  }
}

function hasConsecutiveSequence(before: Transaction, after: Transaction): boolean {
  return (
    Number.isSafeInteger(before.sequenceCount) &&
    Number.isSafeInteger(after.sequenceCount) &&
    (before.sequenceCount ?? 0) > 0 &&
    after.sequenceCount === (before.sequenceCount ?? 0) + 1
  );
}

function validateLink(before: Transaction, after: Transaction): void {
  const consecutive = hasConsecutiveSequence(before, after);

  const later =
    Number.isFinite(Date.parse(before.dueAt)) && Date.parse(after.dueAt) > Date.parse(before.dueAt);

  const sameSeries =
    before.frequency !== "ONE_OFF" &&
    before.frequency === after.frequency &&
    before.type === after.type &&
    before.subType === after.subType &&
    before.eventId === after.eventId &&
    before.timezone === after.timezone &&
    before.notes === after.notes &&
    before.payee?.id === after.payee?.id &&
    JSON.stringify(before.targetFrom) === JSON.stringify(after.targetFrom) &&
    JSON.stringify(before.targetTo) === JSON.stringify(after.targetTo);

  if (!consecutive || !later || !sameSeries) {
    throw new Error(
      `Unverified recurring chain boundary: ${before.id} -> ${after.id}. No records will be deleted`
    );
  }
}

async function readOccurrence(plan: MutationPlan, id: string): Promise<Transaction> {
  ObjectIdSchema.parse(id);
  const name = `${plan.client.budgetPath}/transactions/${id}`;
  const { doc } = await plan.entry(name);
  const transaction = TransactionSchema.parse(doc.data);

  if (doc.name !== name || transaction.id !== id || transaction.budgetId !== plan.client.budgetId) {
    throw new Error("The recurring transaction identity does not match its document path");
  }

  return transaction;
}

async function predecessor(
  plan: MutationPlan,
  transaction: Transaction
): Promise<Transaction | undefined> {
  if (plan.snapshot === undefined) {
    throw new Error("Recurring deletion requires a consistent transaction snapshot");
  }

  const candidates = await plan.snapshot.query(
    "transactions",
    "clonedToTransactionId",
    transaction.id,
    2
  );

  if (candidates.length > 1) {
    throw new Error(`Ambiguous recurring chain: multiple predecessors point to ${transaction.id}`);
  }

  const [candidate] = candidates;

  if (candidate === undefined) {
    return undefined;
  }

  const parsed = TransactionSchema.parse(candidate.data);
  const before = await readOccurrence(plan, parsed.id);

  if (
    before.clonedToTransactionId !== transaction.id ||
    candidate.name !== `${plan.client.budgetPath}/transactions/${before.id}`
  ) {
    throw new Error("Invalid recurring predecessor query response");
  }

  validateLink(before, transaction);

  return before;
}

export async function planRecurringDeletion(
  plan: MutationPlan,
  id: string,
  scope: z.infer<typeof TransactionDeleteScopeSchema>
) {
  TransactionDeleteScopeSchema.parse(scope);
  const selected = await readOccurrence(plan, id);
  const previous = await predecessor(plan, selected);
  const chain = [selected];
  const visited = new Set([id, ...(previous === undefined ? [] : [previous.id])]);
  let current = selected;

  while (
    current.clonedToTransactionId !== undefined &&
    current.clonedToTransactionId !== null &&
    current.clonedToTransactionId !== ""
  ) {
    if (visited.has(current.clonedToTransactionId)) {
      throw new Error("A recurring clone chain contains a cycle");
    }

    if (chain.length >= MaxOccurrences) {
      throw new Error("Recurring deletion exceeds the 100-occurrence inspection limit");
    }

    const next = await readOccurrence(plan, current.clonedToTransactionId);
    validateLink(current, next);
    const incoming = await predecessor(plan, next);

    if (incoming?.id !== current.id) {
      throw new Error("The recurring chain has inconsistent forward and predecessor links");
    }

    chain.push(next);
    visited.add(next.id);
    current = next;
  }

  const exhausted =
    selected.repeatCount !== null &&
    selected.repeatCount > 0 &&
    selected.sequenceCount !== null &&
    selected.repeatCount === selected.sequenceCount;

  if (
    scope === "THIS_PAYMENT" &&
    selected.frequency !== "ONE_OFF" &&
    chain.length === 1 &&
    !exhausted
  ) {
    throw new Error(
      "THIS_PAYMENT cannot preserve an ongoing recurring tail without a generated successor. Native recurrence generation is not supported; use THIS_AND_LATER only to stop the series"
    );
  }

  return {
    deleted: scope === "THIS_AND_LATER" ? chain : [selected],
    preserved: [
      ...(previous === undefined ? [] : [previous]),
      ...(scope === "THIS_PAYMENT" ? chain.slice(1) : []),
    ],
  };
}
