/* oxlint-disable complexity, no-await-in-loop -- Keep the ordered ledger effects of one transaction together. */
import { PeriodSchema } from "./model.ts";
import type { Target, Transaction } from "./transaction-model.ts";
import { makeTarget } from "./transaction-target.ts";
import type { MutationPlan, TransactionContext } from "./transactions.ts";

// Native shared history writer 51717 selects the due-date month in the runtime system timezone.
const historyMonth = (transaction: Transaction): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(transaction.dueAt));

  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${fields.year}-${fields.month}`;
};

const requireIncomeHistoryMonth = (transaction: Transaction): void => {
  if (historyMonth(transaction) !== transaction.yearMonth) {
    throw new Error(
      "Income history month differs from the runtime due-date month. Resolve it in the app"
    );
  }
};

const requireTarget = (target: Target | null): Target => {
  if (!target) {
    throw new Error("Transaction is missing a required target");
  }

  return target;
};

const requireLedgerTargets = (transaction: Transaction, context: TransactionContext) => {
  const account = transaction.type === "OUTFLOW" ? transaction.targetFrom : transaction.targetTo;

  if (!account || !["GENERIC_ACCOUNT", "CREDIT_CARD"].includes(account.type)) {
    throw new Error("The transaction is missing a supported account target");
  }

  if (
    transaction.type === "INFLOW" &&
    (transaction.targetFrom !== null || account.type === "CREDIT_CARD")
  ) {
    throw new Error("Refunds and linked income require a separate ledger flow");
  }

  const current = makeTarget(account.id, "account", context.accountMap, context.categoryMap);

  if (
    current.type !== account.type ||
    current.linkedObjectId !== account.linkedObjectId ||
    current.linkedObjectType !== account.linkedObjectType
  ) {
    throw new Error(
      "The saved transaction and current account links disagree. Resolve them in the app"
    );
  }

  if (transaction.type === "OUTFLOW") {
    const category = requireTarget(transaction.targetTo);

    if (category.type !== "CATEGORY") {
      throw new Error("The expense is missing a category target");
    }

    const currentCategory = makeTarget(
      category.id,
      "category",
      context.accountMap,
      context.categoryMap
    );

    if (
      currentCategory.linkedObjectId !== category.linkedObjectId ||
      currentCategory.linkedObjectType !== category.linkedObjectType
    ) {
      throw new Error(
        "The saved expense category has linked-account effects. Resolve them in the app"
      );
    }

    if (transaction.subType === "REFUND" && account.type !== "CREDIT_CARD") {
      throw new Error("REFUND requires a credit-card account and an expense category");
    }
  }

  const currency = context.accountMap[account.id]?.currencyCode;

  if (currency !== undefined && currency !== "" && currency !== context.user.config?.currencyCode) {
    throw new Error("bebu does not support changes to foreign-currency ledgers");
  }
};

export const applyTransactionLedger = async (
  plan: MutationPlan,
  transaction: Transaction,
  direction: 1 | -1,
  context: TransactionContext
) => {
  requireLedgerTargets(transaction, context);

  if (
    !transaction.completed &&
    (transaction.periodId === undefined || transaction.periodId === null)
  ) {
    return;
  }

  if (transaction.periodId === undefined || transaction.periodId === null) {
    throw new Error("The transaction has no budget period. Select its month in the app");
  }

  const periodPath = `${plan.client.budgetPath}/periods/${transaction.periodId}`;
  const entryResult = await plan.entry(periodPath);
  PeriodSchema.parse(entryResult.doc.data);

  const delta =
    direction * (transaction.type === "OUTFLOW" ? -transaction.amount : transaction.amount);

  const accountPath = context.accounts.name;

  const periodInc = async (id: string, key: string, change: number) => {
    await plan.increment(periodPath, ["balances", id, key], change);
  };

  const balance = async (account: Target, change: number) => {
    await plan.increment(accountPath, ["data", account.id, "balanceAmount"], change);
  };

  const history = async (id: string, key: string, change: number) => {
    await plan.increment(
      `${plan.client.budgetPath}/stashes/${id}`,
      ["data", key, historyMonth(transaction)],
      change
    );
  };

  const accountEffects = async (account: Target, n: number) => {
    if (!transaction.cleared) {
      await plan.increment(accountPath, ["data", account.id, "unclearedBalanceAmount"], n);

      return;
    }

    if (transaction.type === "INFLOW") {
      requireIncomeHistoryMonth(transaction);
    }

    await balance(account, n);

    await history(account.id, "historicalBalances", n);
  };

  if (transaction.type === "OUTFLOW") {
    const from = requireTarget(transaction.targetFrom);
    const to = requireTarget(transaction.targetTo);

    if (transaction.completed) {
      if (from.type === "CREDIT_CARD") {
        if (from.linkedObjectId === null || from.linkedObjectId === "") {
          throw new Error("Credit card has no linked payment category");
        }

        // Native 51758 records the full charge in otherAmount, including unfunded spending.
        // It does not allocate category funds or cap the reserve increment at available funds.
        await periodInc(from.linkedObjectId, "otherAmount", delta);
      }

      await accountEffects(from, -delta);
      await periodInc(to.id, "spentAmount", delta);
      await history(to.id, "historicalSpending", delta);
    } else {
      await periodInc(to.id, "upcomingAmount", delta);
    }
  } else if (transaction.type === "INFLOW" && transaction.completed) {
    await accountEffects(requireTarget(transaction.targetTo), delta);

    // Native 51745 adds cleared zero-based income to allocation resources, independently of category allocation.
    if (transaction.cleared && context.budget.data.type === "ZERO_BASED") {
      await plan.increment(periodPath, ["allocationAmount"], delta);
    }
  }

  if (transaction.completed) {
    for (const id of [transaction.payee?.id, ...transaction.tagIds].filter(
      (candidate): candidate is string => typeof candidate === "string"
    )) {
      if (transaction.cleared) {
        await history(id, "historicalBalances", direction * transaction.amount);
      }

      if (transaction.type === "OUTFLOW") {
        // Native 51721 passes abs=true for payees/tags, including refunds.
        await history(id, "historicalSpending", direction * Math.abs(transaction.amount));
      }
    }
  }
};
