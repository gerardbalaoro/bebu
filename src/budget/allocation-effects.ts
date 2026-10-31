import { z } from "zod";

import type { Data } from "../firestore/encoding.ts";
import type { Target, Transaction } from "./transaction-model.ts";

const historySchema = z.record(z.string(), z.looseObject({ id: z.string().optional() }));

const hasLinkedAllocation = (transaction: Transaction, target: Target | null): boolean => {
  if (transaction.targetFrom?.linkedObjectId === transaction.targetTo?.linkedObjectId) {
    return false;
  }

  // Native 51847–51849 requires every condition; the capability flag alone has no ledger effect.
  return (
    transaction.completed &&
    transaction.cleared &&
    transaction.autoAllocateIfCapable &&
    transaction.version !== null &&
    target?.type === "GENERIC_ACCOUNT" &&
    target.linkedObjectType === "CATEGORY" &&
    target.linkedObjectId !== null &&
    target.linkedObjectId.trim() !== ""
  );
};

export const requireIndependentTransaction = (transaction: Transaction, budget: Data): void => {
  const history = historySchema.parse(
    budget.allocationHistory === undefined ? {} : budget.allocationHistory
  );

  const hasHistory = Object.entries(history).some(
    ([key, entry]) => key === transaction.id || entry.id === transaction.id
  );

  // Native 51742 has a separate completed/cleared income path requiring an actual extra target.
  const hasIncomeAllocation =
    transaction.type === "INFLOW" &&
    transaction.completed &&
    transaction.cleared &&
    transaction.autoAllocateIfIncome === true &&
    transaction.extraTarget !== null;

  const allocationPossible =
    hasHistory ||
    Boolean(transaction.extras.autoAllocated) ||
    hasLinkedAllocation(transaction, transaction.targetFrom) ||
    hasLinkedAllocation(transaction, transaction.targetTo) ||
    hasIncomeAllocation;

  if (allocationPossible) {
    throw new Error(
      "This transaction has confirmed or possible native allocation effects. bebu cannot reverse or change those effects yet. Use the app for deletion, financial edits, or schedule edits; metadata remains editable"
    );
  }
};
