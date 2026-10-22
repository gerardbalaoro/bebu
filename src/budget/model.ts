import { z } from "zod";

export const BudgetSchema = z
  .object({
    availablePeriods: z.record(z.string(), z.object({ id: z.string() })),
    stashIdentifiers: z.record(z.string(), z.string()),
  })
  .loose();

export const CategorySchema = z
  .object({
    archived: z.boolean().optional(),
    color: z.string().optional(),
    deleted: z.boolean().optional(),
    groupId: z.string().optional(),
    id: z.string(),
    linkedAccountIds: z.array(z.string()).default([]),
    name: z.string().optional(),
    type: z.string(),
  })
  .loose();

export type Category = z.infer<typeof CategorySchema>;

export const CategoriesSchema = z
  .object({
    data: z.object({ categories: z.record(z.string(), CategorySchema) }).loose(),
  })
  .loose();

export const BalanceSchema = z
  .object({
    allocatedAmount: z.number().optional(),
    carriedOverAmount: z.number().optional(),
    otherAmount: z.number().optional(),
    spentAmount: z.number().optional(),
    upcomingAmount: z.number().optional(),
  })
  .loose();

export type Balance = z.infer<typeof BalanceSchema>;

export const PeriodSchema = z
  .object({ balances: z.record(z.string(), BalanceSchema).default({}) })
  .loose();

export const categoryAvailable = (balance: Balance | undefined): number =>
  (balance?.allocatedAmount ?? 0) +
  (balance?.carriedOverAmount ?? 0) +
  (balance?.otherAmount ?? 0) -
  (balance?.spentAmount ?? 0);
