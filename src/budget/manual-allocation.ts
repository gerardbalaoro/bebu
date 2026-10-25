/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- These schema and canonical JSON boundaries validate untrusted Firestore or saved-plan values. */
/* oxlint-disable func-style -- Named domain functions follow the repository TypeScript conventions. */
import { z } from "zod";

import { ObjectIdSchema } from "./transaction-model.ts";

const MoneySchema = z.number().int();

const CategorySchema = z.object({
  accumulationStrategy: z.enum(["DEFAULT", "FUND_OVERRUNS"]).default("DEFAULT"),
  amountComputationStrategy: z.enum(["COMPUTE", "SKIP"]).default("COMPUTE"),
  archived: z.boolean().default(false),
  carryOverStrategy: z.enum(["ALL", "NONE"]).default("ALL"),
  deleted: z.boolean().default(false),
  groupId: ObjectIdSchema,
  id: ObjectIdSchema,
  linkedAccountIds: z.array(ObjectIdSchema).default([]),
  parentCategoryId: z.string().default(""),
  systemGenerated: z.boolean().default(false),
  type: z.enum(["DEFAULT", "INCOME", "CREDIT_CARD_PAYMENT", "LOAN_PAYMENT"]).default("DEFAULT"),
});

const GroupSchema = z.object({
  archived: z.boolean().default(false),
  id: ObjectIdSchema,
  type: z.enum(["DEFAULT", "INCOME", "DEBT_PAYMENT"]).default("DEFAULT"),
});

export const ManualIndexSchema = z.object({
  categories: z.record(z.string(), CategorySchema),
  groups: z.record(z.string(), GroupSchema),
});

export const ManualBalanceSchema = z.object({
  allocatedAmount: MoneySchema.default(0),
  carriedOverAmount: MoneySchema.default(0),
  otherAmount: MoneySchema.default(0),
  spentAmount: MoneySchema.default(0),
  upcomingAmount: MoneySchema.default(0),
});

export const ManualPeriodSchema = z.object({
  allocationAmount: MoneySchema.default(0),
  allocationCarriedOverAmount: MoneySchema.default(0),
  balances: z.record(z.string(), ManualBalanceSchema).default({}),
  id: ObjectIdSchema,
  yearMonth: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u),
});

const AccountSchema = z.object({
  archived: z.boolean().default(false),
  balanceAmount: MoneySchema,
  currencyCode: z.string().default(""),
  id: ObjectIdSchema,
  linkedCategoryId: z
    .string()
    .nullish()
    .transform((value) => value ?? ""),
  type: z.string(),
  unclearedBalanceAmount: MoneySchema.default(0),
});

const InputSchema = z.object({
  accounts: z.record(z.string(), AccountSchema),
  categoryId: ObjectIdSchema,
  currencyCode: z.string().min(1),
  index: ManualIndexSchema,
  period: ManualPeriodSchema,
});

export const AllocationIntentSchema = z.union([
  z.strictObject({ amount: MoneySchema }),
  z.strictObject({ matchLinked: z.literal(true) }),
]);

export type AllocationIntent = z.infer<typeof AllocationIntentSchema>;

function money(value: bigint) {
  return MoneySchema.parse(Number(value));
}

function availability(balance: z.infer<typeof ManualBalanceSchema>) {
  return money(
    BigInt(balance.allocatedAmount) +
      BigInt(balance.carriedOverAmount) +
      BigInt(balance.otherAmount) -
      BigInt(balance.spentAmount)
  );
}

function assessOverallocation(before: number, after: number) {
  const amount = money(BigInt(Math.max(-after, 0)));
  let status = "NONE";

  if (amount > 0 && before >= 0) {
    status = "CAUSED";
  } else if (before < 0 && after < before) {
    status = "INCREASED";
  } else if (before < 0 && after > before) {
    status = amount === 0 ? "FIXED" : "DECREASED";
  }

  return { overallocationAmount: status === "NONE" ? 0 : amount, overallocationStatus: status };
}

function validateIndex(index: z.infer<typeof ManualIndexSchema>) {
  for (const [key, group] of Object.entries(index.groups)) {
    if (key !== group.id || group.archived) {
      throw new Error(`Unsupported allocation group ${key}: identity or archive`);
    }
  }

  for (const [key, category] of Object.entries(index.categories)) {
    if (key !== category.id || !index.groups[category.groupId] || category.archived) {
      throw new Error(`Unsupported allocation category ${key}: identity, group, or archive`);
    }

    if (category.parentCategoryId) {
      const parent = index.categories[category.parentCategoryId];

      if (
        !parent ||
        parent.id === key ||
        parent.parentCategoryId ||
        parent.groupId !== category.groupId ||
        parent.deleted
      ) {
        throw new Error(`Unsupported allocation hierarchy for ${key}`);
      }
    }
  }
}

function linkedAccounts(
  input: z.infer<typeof InputSchema>,
  category: z.infer<typeof CategorySchema>
) {
  const ids = category.linkedAccountIds;

  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate category account link");
  }

  for (const [key, account] of Object.entries(input.accounts)) {
    if (key !== account.id || (account.linkedCategoryId === category.id && !ids.includes(key))) {
      throw new Error(`Conflicting reverse account link ${key}`);
    }
  }

  return ids.map((id) => {
    const account = input.accounts[id];

    if (
      !account ||
      account.type !== "SAVINGS" ||
      (account.currencyCode !== "" && account.currencyCode !== input.currencyCode)
    ) {
      throw new Error(`Unsupported linked savings account ${id}: identity, type, or currency`);
    }

    const conflicts = Object.values(input.index.categories).some(
      (other) => other.id !== category.id && !other.deleted && other.linkedAccountIds.includes(id)
    );

    if (conflicts) {
      throw new Error(`Conflicting category account link ${id}`);
    }

    const inactive =
      account.archived &&
      account.balanceAmount === 0 &&
      account.unclearedBalanceAmount === 0 &&
      account.linkedCategoryId === "";

    if (!inactive && (account.archived || account.linkedCategoryId !== category.id)) {
      throw new Error(`Unsupported account link ${id}: archive or reverse link`);
    }

    return { ...account, status: inactive ? "archived-zero-orphan" : "linked" };
  });
}

function selectedCategory(context: z.infer<typeof InputSchema>) {
  const { categoryId, index } = context;
  const category = index.categories[categoryId];

  if (
    !category ||
    category.deleted ||
    category.type !== "DEFAULT" ||
    category.systemGenerated ||
    category.amountComputationStrategy !== "COMPUTE" ||
    index.groups[category.groupId]?.type !== "DEFAULT"
  ) {
    throw new Error("Manual allocation requires an existing ordinary COMPUTE category");
  }

  if (category.carryOverStrategy !== "ALL") {
    throw new Error("Manual allocation requires ALL carryover");
  }

  if (
    Object.values(index.categories).some(
      (entry) => !entry.deleted && entry.parentCategoryId === categoryId
    )
  ) {
    throw new Error("Manual allocation to a parent category is unsupported");
  }

  return category;
}

function allocationPool(context: z.infer<typeof InputSchema>) {
  const { index, period } = context;

  for (const [id, balance] of Object.entries(period.balances)) {
    if (!index.categories[id] && Object.values(balance).some((amount) => amount !== 0)) {
      throw new Error(`Unindexed allocation balance ${id}`);
    }
  }

  let allocated = 0n;

  for (const entry of Object.values(index.categories)) {
    if (
      !entry.deleted &&
      index.groups[entry.groupId]?.type !== "INCOME" &&
      entry.amountComputationStrategy === "COMPUTE"
    ) {
      allocated += BigInt(period.balances[entry.id]?.allocatedAmount ?? 0);
    }
  }

  money(allocated);

  const pool = money(
    BigInt(period.allocationAmount) + BigInt(period.allocationCarriedOverAmount) - allocated
  );

  return pool;
}

export function calculateManualAllocation(input: unknown, rawIntent: AllocationIntent) {
  const context = InputSchema.parse(input);
  const intent = AllocationIntentSchema.parse(rawIntent);
  validateIndex(context.index);
  const { categoryId, period } = context;
  const category = selectedCategory(context);
  const pool = allocationPool(context);
  const balance = period.balances[categoryId] ?? ManualBalanceSchema.parse({});
  const links = linkedAccounts(context, category);
  const active = links.filter((account) => !account.archived);

  if ("matchLinked" in intent && active.length !== 1) {
    throw new Error("Account matching requires exactly one active linked savings account");
  }

  const amount =
    "amount" in intent
      ? intent.amount
      : money(
          BigInt(active[0]?.balanceAmount ?? 0) -
            BigInt(balance.carriedOverAmount) -
            BigInt(balance.otherAmount) +
            BigInt(balance.spentAmount)
        );

  const delta = money(BigInt(amount) - BigInt(balance.allocatedAmount));

  if (delta > 0 && delta > pool) {
    throw new Error("Allocation exceeds available funds; reductions remain allowed");
  }

  const remaining = money(BigInt(pool) - BigInt(delta));

  return {
    after: {
      allocation: amount,
      available: availability({ ...balance, allocatedAmount: amount }),
      pool: remaining,
    },
    before: { allocation: balance.allocatedAmount, available: availability(balance), pool },
    categoryId,
    delta,
    history: assessOverallocation(pool, remaining),
    links,
    noChange: delta === 0,
  };
}
