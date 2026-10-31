/* oxlint-disable no-await-in-loop -- Validate saved labels before planning the edit. */
import type { BeyondClient } from "../firestore/client.ts";
import { LabelsSchema } from "./labels.ts";
import type { Transaction, TransactionPatch } from "./transaction-model.ts";
import { editSchedule } from "./transaction-schedule.ts";
import { makeTarget } from "./transaction-target.ts";
import type { TransactionContext } from "./transactions.ts";

export const editTransaction = async (
  client: BeyondClient,
  transaction: Transaction,
  input: TransactionPatch,
  context: TransactionContext
) => {
  const { accountId, amountMinor, categoryId, payeeId, recurrenceScope, ...fields } = input;
  void recurrenceScope;
  const after: Transaction = { ...transaction, ...fields };

  if (amountMinor !== undefined) {
    after.amount = transaction.type === "INFLOW" ? amountMinor : -amountMinor;
  }

  if (accountId !== undefined) {
    const target = makeTarget(accountId, "account", context.accountMap, context.categoryMap);

    if (transaction.type === "OUTFLOW") {
      after.targetFrom = target;
    } else if (transaction.type === "INFLOW" && target.type !== "CREDIT_CARD") {
      after.targetTo = target;
    } else {
      throw new Error("Choose a supported expense or income account");
    }
  }

  if (categoryId !== undefined) {
    if (transaction.type !== "OUTFLOW") {
      throw new Error("Only expenses have an expense category");
    }

    after.targetTo = makeTarget(categoryId, "category", context.accountMap, context.categoryMap);
  }

  if (payeeId !== undefined) {
    after.payee = null;

    if (payeeId !== null) {
      const payees = await client.stash("PAYEES", LabelsSchema);
      const payee = payees.data.data[payeeId];

      if (!payee || payee.archived === true) {
        throw new Error("Payee not found");
      }

      after.payee = { id: payeeId, linkedObjectId: null, linkedObjectType: null, type: "PAYEE" };
    }
  }

  if (input.tagIds !== undefined) {
    const tags = await client.stash("TAGS", LabelsSchema);

    for (const id of input.tagIds) {
      if (!tags.data.data[id] || tags.data.data[id].archived === true) {
        throw new Error("Tag not found");
      }
    }
  }

  editSchedule(transaction, after, input, context);

  if (
    input.color !== undefined &&
    input.color !== "NONE" &&
    !Object.values(context.categoryMap).some((category) => category.color === input.color)
  ) {
    throw new Error("Choose a color value from an existing category");
  }

  return after;
};
