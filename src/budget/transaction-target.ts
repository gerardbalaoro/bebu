import { z } from "zod";

import type { Account } from "./accounts.ts";
import type { Category } from "./model.ts";
import { ObjectIdSchema } from "./transaction-model.ts";
import type { Target } from "./transaction-model.ts";

const categoryTarget = (id: string, categories: Record<string, Category>): Target => {
  const category = categories[id];

  if (!category || category.archived === true || category.deleted === true) {
    throw new Error("Category not available");
  }

  if (category.type !== "DEFAULT") {
    throw new Error("Card payments require a transfer. Special categories cannot receive expenses");
  }

  return { id, linkedObjectId: null, linkedObjectType: null, type: "CATEGORY" };
};

const accountTarget = (
  id: string,
  accounts: Record<string, Account>,
  categories: Record<string, Category>
): Target => {
  const account = accounts[id];

  if (!account || account.archived === true || account.hidden === true || account.locked === true) {
    throw new Error("Account is archived, hidden, locked, or missing");
  }

  if (
    !["CREDIT_CARD", "SAVINGS", "CHECKING", "CASH", "CASH_ON_HAND", "INVESTMENT"].includes(
      account.type
    )
  ) {
    throw new Error(`Unsupported account type ${account.type}`);
  }

  const linked = Object.values(categories).filter((category) =>
    category.linkedAccountIds?.includes(id)
  );

  if (linked.length > 1) {
    throw new Error("Account has multiple linked categories");
  }

  if (account.linkedCategoryId !== undefined) {
    const storedLink = z.string().nullable().parse(account.linkedCategoryId);
    const accountLink = storedLink === "" ? null : storedLink;

    if (accountLink !== (linked[0]?.id ?? null)) {
      throw new Error(
        "Account and category links disagree. Resolve the links in the app before this transaction"
      );
    }
  }

  return {
    id,
    linkedObjectId: linked[0]?.id ?? null,
    linkedObjectType: linked.length ? "CATEGORY" : null,
    type: account.type === "CREDIT_CARD" ? "CREDIT_CARD" : "GENERIC_ACCOUNT",
  };
};

export const makeTarget = (
  id: string,
  kind: "account" | "category",
  accounts: Record<string, Account>,
  categories: Record<string, Category>
): Target => {
  ObjectIdSchema.parse(id);

  return kind === "category"
    ? categoryTarget(id, categories)
    : accountTarget(id, accounts, categories);
};
