/* oxlint-disable complexity, no-await-in-loop -- Keep the ordered ledger effects of one transaction together. */
import { PeriodSchema } from "./model.ts";
import type { Target, Transaction } from "./transaction-model.ts";
import { makeTarget } from "./transaction-target.ts";
import type { MutationPlan, TransactionContext } from "./transactions.ts";

// Native inflow history (51731) selects the due-date month in the runtime system timezone.
// Reject disagreement with the stored month instead of moving money between guessed history keys.
const incomeHistoryMonth = (transaction: Transaction): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(transaction.dueAt));

  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const month = `${fields.year}-${fields.month}`;

  if (month !== transaction.yearMonth) {
    throw new Error(
      "Income history month differs from the runtime due-date month. Resolve it in the app"
    );
  }

  return month;
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

    makeTarget(category.id, "category", context.accountMap, context.categoryMap);
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

  const available = (id: string) =>
    ["allocatedAmount", "carriedOverAmount", "otherAmount"].reduce(
      (total, field) =>
        total + BigInt(plan.amountChange(periodPath, ["balances", id, field])?.after ?? 0),
      0n
    ) - BigInt(plan.amountChange(periodPath, ["balances", id, "spentAmount"])?.after ?? 0);

  const amount = Math.abs(transaction.amount);
  const delta = direction * amount;
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
      ["data", key, transaction.yearMonth],
      change
    );
  };

  const accountEffects = async (account: Target, n: number) => {
    if (transaction.type === "INFLOW" && !transaction.cleared) {
      await plan.increment(accountPath, ["data", account.id, "unclearedBalanceAmount"], n);

      return;
    }

    if (transaction.type === "INFLOW") {
      incomeHistoryMonth(transaction);
    }

    await balance(account, n);

    if (!transaction.cleared) {
      await plan.increment(accountPath, ["data", account.id, "unclearedBalanceAmount"], n);
    }

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

        if (direction > 0 && available(to.id) < BigInt(amount)) {
          throw new Error(
            "Fund the expense category first. bebu does not allocate funds automatically"
          );
        }

        if (direction < 0 && available(to.id) < 0n) {
          throw new Error(
            "bebu cannot reverse unfunded card spending. The reversal requires changes to fund allocation"
          );
        }

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
      await history(id, "historicalBalances", direction * transaction.amount);

      if (transaction.type === "OUTFLOW") {
        await history(id, "historicalSpending", -direction * transaction.amount);
      }
    }
  }
};
