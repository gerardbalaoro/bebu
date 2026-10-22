import { fundingAmounts } from "./funding.ts";
import type { Balance } from "./model.ts";
import type { Transaction } from "./transaction-model.ts";
import type { MutationPlan } from "./transactions.ts";

const transactionDetails = (transaction: Transaction | null) =>
  transaction && {
    amount: transaction.amount,
    cleared: transaction.cleared,
    color: transaction.color,
    completed: transaction.completed,
    dueAt: transaction.dueAt,
    id: transaction.id,
    notes: transaction.notes,
    targetFrom: transaction.targetFrom,
    targetTo: transaction.targetTo,
    type: transaction.type,
    yearMonth: transaction.yearMonth,
  };

const accountChanges = (plan: MutationPlan, transaction: Transaction) => {
  const accountPath = `${plan.client.budgetPath}/stashes/${plan.client.stashId("ACCOUNTS")}`;

  const ids = new Set(
    [transaction.targetFrom, transaction.targetTo].flatMap((target) =>
      target !== null && target.type !== "CATEGORY" ? [target.id] : []
    )
  );

  return [...ids].flatMap((id) => {
    const balanceAmount = plan.amountChange(accountPath, ["data", id, "balanceAmount"]);

    const unclearedBalanceAmount = plan.amountChange(accountPath, [
      "data",
      id,
      "unclearedBalanceAmount",
    ]);

    if (!balanceAmount?.delta && !unclearedBalanceAmount?.delta) {
      return [];
    }

    return [{ balanceAmount, id, unclearedBalanceAmount }];
  });
};

const categoryChanges = (plan: MutationPlan, transaction: Transaction) => {
  if (!transaction.periodId) {
    return [];
  }

  const periodPath = `${plan.client.budgetPath}/periods/${transaction.periodId}`;
  const categories = new Map<string, string>();

  for (const target of [transaction.targetFrom, transaction.targetTo]) {
    if (target?.type === "CATEGORY") {
      categories.set(target.id, "expense");
    }
  }

  const card = transaction.targetFrom;

  if (card?.type === "CREDIT_CARD" && card.linkedObjectId) {
    categories.set(card.linkedObjectId, "cardPaymentReserve");
  }

  return [...categories].flatMap(([id, role]) => {
    const before: Balance = {};
    const after: Balance = {};
    let changed = false;

    for (const field of [
      "allocatedAmount",
      "carriedOverAmount",
      "otherAmount",
      "spentAmount",
      "upcomingAmount",
    ] as const) {
      const amount = plan.amountChange(periodPath, ["balances", id, field]);
      before[field] = amount?.before ?? 0;
      after[field] = amount?.after ?? 0;
      changed ||= !!amount?.delta;
    }

    return changed
      ? [
          {
            after: fundingAmounts(after),
            before: fundingAmounts(before),
            id,
            role,
            yearMonth: transaction.yearMonth,
          },
        ]
      : [];
  });
};

export const transactionSummary = (
  plan: MutationPlan,
  before: Transaction | null,
  after: Transaction | null
) => {
  const transaction = after ?? before;

  if (!transaction) {
    throw new Error("A transaction summary needs a before or after record");
  }

  let operation = "update";

  if (!before) {
    operation = "create";
  } else if (!after) {
    operation = "delete";
  }

  return {
    accounts: accountChanges(plan, transaction),
    automaticAllocation: false,
    categories: categoryChanges(plan, transaction),
    operation,
    transaction: { after: transactionDetails(after), before: transactionDetails(before) },
  };
};
