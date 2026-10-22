import { z } from "zod";

import type { Data } from "../firestore/encoding.ts";
import type { Transaction } from "./transaction-model.ts";

const historySchema = z.record(z.string(), z.looseObject({ id: z.string().optional() }));

export const requireIndependentTransaction = (transaction: Transaction, budget: Data): void => {
  const history = historySchema.parse(
    budget.allocationHistory === undefined ? {} : budget.allocationHistory
  );

  const hasHistory = Object.entries(history).some(
    ([key, entry]) => key === transaction.id || entry.id === transaction.id
  );

  // Native linked income can have empty extras. Flags indicate possible effects, not proof of them.
  // Keep financial edits separate from notes/color until native reversal and clearing rules are known.
  const allocationPossible =
    hasHistory ||
    Boolean(transaction.extras.autoAllocated) ||
    transaction.autoAllocateIfCapable ||
    (transaction.type === "INFLOW" && transaction.autoAllocateIfIncome === true);

  if (allocationPossible) {
    throw new Error(
      "This transaction has confirmed or possible native allocation effects. bebu cannot reverse or change those effects yet. Use the app for deletion or clearing changes; notes and color remain editable"
    );
  }
};
