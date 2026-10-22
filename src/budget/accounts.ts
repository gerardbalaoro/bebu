import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { patchDocument } from "../firestore/encoding.ts";
import type { CommitOptions } from "../firestore/encoding.ts";

export const AccountSchema = z.looseObject({
  archived: z.boolean().optional(),
  balanceAmount: z.number().optional(),
  color: z.string().optional(),
  currencyCode: z.string().optional(),
  hidden: z.boolean().optional(),
  icon: z.string().optional(),
  id: z.string(),
  locked: z.boolean().optional(),
  name: z.string(),
  transactionCount: z.number().optional(),
  type: z.string(),
  unclearedBalanceAmount: z.number().optional(),
});

export const AccountsSchema = z.looseObject({ data: z.record(z.string(), AccountSchema) });

export type Account = z.infer<typeof AccountSchema>;

export const AccountPatchSchema = z
  .strictObject({
    closingDay: z.number().int().min(1).max(31).nullable().optional(),
    color: z.string().optional(),
    dueDay: z.number().int().min(1).max(31).nullable().optional(),
    dueDayOnBusinessDaysOnly: z.boolean().optional(),
    dynamicClosingDay: z.boolean().optional(),
    hidden: z.boolean().optional(),
    icon: z.string().optional(),
    limitAmount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    name: z.string().trim().min(1).max(30).optional(),
    notes: z.string().max(400).optional(),
    pinned: z.boolean().optional(),
    showClosingBalance: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "An account patch must contain a field");

export type AccountPatch = z.infer<typeof AccountPatchSchema>;

export class AccountService {
  readonly client: BeyondClient;

  constructor(client: BeyondClient) {
    this.client = client;
  }

  async list(): Promise<Account[]> {
    const stashResult = await this.client.stash("ACCOUNTS", AccountsSchema);

    return Object.values(stashResult.data.data);
  }

  async show(id: string): Promise<Account> {
    const listResult = await this.list();
    const account = listResult.find((entry) => entry.id === id);

    if (!account) {
      throw new Error("Account not found");
    }

    return account;
  }

  async update(id: string, input: AccountPatch, options: CommitOptions = {}) {
    const changes = AccountPatchSchema.parse(input);
    const document = await this.client.stash("ACCOUNTS", AccountsSchema);

    if (!document.data.data[id]) {
      throw new Error("Account not found");
    }

    for (const key of ["color", "icon"] as const) {
      if (
        changes[key] !== undefined &&
        !Object.values(document.data.data).some((account) => account[key] === changes[key])
      ) {
        throw new Error(`Choose an existing account ${key} value`);
      }
    }

    return await this.client.commit(
      [
        patchDocument(
          document,
          Object.entries(changes).map(([key, value]) => ({ path: ["data", id, key], value }))
        ),
      ],
      options
    );
  }
}
