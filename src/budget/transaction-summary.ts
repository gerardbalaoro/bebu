import { fundingAmounts } from "./funding.ts";
import type { Balance } from "./model.ts";
import type { Transaction } from "./transaction-model.ts";
import type { MutationPlan } from "./transactions.ts";

const transactionDetails = (transaction: Transaction | null) =>
  transaction && {
    amount: transaction.amount,
    anchorDay: transaction.anchorDay,
    cleared: transaction.cleared,
    color: transaction.color,
    completed: transaction.completed,
    dueAt: transaction.dueAt,
    frequency: transaction.frequency,
    id: transaction.id,
    latitude: transaction.latitude,
    longitude: transaction.longitude,
    nonWorkingDayPolicy: transaction.nonWorkingDayPolicy,
    notes: transaction.notes,
    occurrenceChange: transaction.occurrenceChange,
    offsetAdjustment: transaction.offsetAdjustment,
    payee: transaction.payee,
    periodId: transaction.periodId,
    reminderDescription: transaction.reminderDescription,
    reminderEnabled: transaction.reminderEnabled,
    reminderName: transaction.reminderName,
    repeatCount: transaction.repeatCount,
    sentiment: transaction.sentiment,
    sequenceCount: transaction.sequenceCount,
    subType: transaction.subType,
    tagIds: transaction.tagIds,
    targetFrom: transaction.targetFrom,
    targetTo: transaction.targetTo,
    timezone: transaction.timezone,
    type: transaction.type,
    yearMonth: transaction.yearMonth,
  };

const accountChanges = (plan: MutationPlan, transactions: Transaction[]) => {
  const accountPath = `${plan.client.budgetPath}/stashes/${plan.client.stashId("ACCOUNTS")}`;

  const ids = new Set(
    transactions
      .flatMap((transaction) => [transaction.targetFrom, transaction.targetTo])
      .flatMap((target) => (target !== null && target.type !== "CATEGORY" ? [target.id] : []))
  );

  return [...ids].flatMap((id) => {
    const balanceAmount = plan.amountChange(accountPath, ["data", id, "balanceAmount"]);

    const unclearedBalanceAmount = plan.amountChange(accountPath, [
      "data",
      id,
      "unclearedBalanceAmount",
    ]);

    if ((balanceAmount?.delta ?? 0) === 0 && (unclearedBalanceAmount?.delta ?? 0) === 0) {
      return [];
    }

    return [{ balanceAmount, id, unclearedBalanceAmount }];
  });
};

const categoryChanges = (plan: MutationPlan, transaction: Transaction) => {
  if (transaction.periodId === undefined || transaction.periodId === null) {
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

  if (card?.type === "CREDIT_CARD" && card.linkedObjectId !== null && card.linkedObjectId !== "") {
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
      changed ||= amount !== undefined && amount.delta !== 0;
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

  const transactions = [before, after].filter((entry): entry is Transaction => entry !== null);
  const categories = new Map<string, ReturnType<typeof categoryChanges>[number]>();

  for (const entry of transactions) {
    for (const category of categoryChanges(plan, entry)) {
      categories.set(`${entry.periodId}/${category.id}`, category);
    }
  }

  const periods = new Map(
    transactions.flatMap((entry) =>
      entry.periodId !== null && entry.periodId !== undefined
        ? [[entry.periodId, entry.yearMonth] as const]
        : []
    )
  );

  return {
    accounts: accountChanges(plan, transactions),
    allocationPeriods: [...periods].flatMap(([periodId, yearMonth]) => {
      const amount = plan.amountChange(`${plan.client.budgetPath}/periods/${periodId}`, [
        "allocationAmount",
      ]);

      return amount !== undefined && amount.delta !== 0 ? [{ ...amount, periodId, yearMonth }] : [];
    }),
    allocationResources:
      transaction.periodId !== undefined && transaction.periodId !== null
        ? plan.amountChange(`${plan.client.budgetPath}/periods/${transaction.periodId}`, [
            "allocationAmount",
          ])
        : undefined,
    automaticAllocation: false,
    categories: [...categories.values()],
    operation,
    transaction: { after: transactionDetails(after), before: transactionDetails(before) },
  };
};
