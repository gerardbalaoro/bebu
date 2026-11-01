/* oxlint-disable func-style -- Named validations keep the native append contract explicit. */
import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema, patchDocument } from "../firestore/encoding.ts";
import type { CommitOptions, Data } from "../firestore/encoding.ts";
import { FirestoreTransaction } from "../firestore/transaction.ts";
import { ObjectIdSchema } from "./transaction-model.ts";
import { TransactionOperations } from "./transaction-operations.ts";

const NativeOrderSchema = z.number().int().nonnegative().max(2_147_483_647);

export const CategoryGroupMoveSchema = z.strictObject({
  categoryId: ObjectIdSchema,
  fromGroupId: ObjectIdSchema,
  groupId: ObjectIdSchema,
});

function ordinary(records: Record<string, Data>, id: string) {
  const record = records[id];

  if (
    !record ||
    record.id !== id ||
    record.type !== "DEFAULT" ||
    record.modifiable !== true ||
    record.archived === true ||
    record.deleted === true
  ) {
    throw new Error(
      "Group moves require identified active modifiable DEFAULT categories and groups"
    );
  }

  return record;
}

function parentOf(category: Data) {
  const parent = z.string().nullish().parse(category.parentCategoryId);

  return parent === undefined || parent === null || parent === ""
    ? null
    : ObjectIdSchema.parse(parent);
}

function appendOrder(
  categories: Record<string, Data>,
  input: z.infer<typeof CategoryGroupMoveSchema>
) {
  const orders = new Set<string>();
  let last = -1;

  for (const [id, category] of Object.entries(categories)) {
    if (category.id !== id || !ObjectIdSchema.safeParse(category.groupId).success) {
      throw new Error("Group moves require explicit category identities and group membership");
    }

    if (parentOf(category) === input.categoryId) {
      throw new Error("Group moves exclude categories with children");
    }

    if (category.groupId !== input.fromGroupId && category.groupId !== input.groupId) {
      continue;
    }

    if (category.archived === true || category.deleted === true) {
      throw new Error(
        "Group move ordering with archived or deleted peers requires separate native evidence"
      );
    }

    const order = NativeOrderSchema.parse(category.order);
    const key = JSON.stringify([category.groupId, order]);

    if (orders.has(key)) {
      throw new Error(
        "Group move would require native peer order normalization; resolve duplicate orders first"
      );
    }

    orders.add(key);

    if (category.groupId === input.groupId) {
      if (parentOf(category) !== null) {
        throw new Error("Group moves require a flat destination group");
      }

      last = Math.max(last, order);
    }
  }

  if (last < 0 || last === 2_147_483_647) {
    throw new Error(
      "Group moves require a nonempty destination with room in the native order range"
    );
  }

  return last + 1;
}

// Native append fixtures preserve all peer values and sparse source settings.
export class CategoryGroupService {
  private readonly client: BeyondClient;
  private readonly operations: TransactionOperations;
  constructor(client: BeyondClient, options: { home?: string } = {}) {
    this.client = client;
    this.operations = new TransactionOperations(client, options);
  }
  async move(value: z.input<typeof CategoryGroupMoveSchema>, options: CommitOptions = {}) {
    const input = CategoryGroupMoveSchema.parse(value);

    return await this.operations.run(
      { action: "move-category", input },
      options,
      async (bound) => await this.execute(input, bound)
    );
  }
  private async execute(input: z.infer<typeof CategoryGroupMoveSchema>, options: CommitOptions) {
    const { client } = this;

    if (input.fromGroupId === input.groupId) {
      throw new Error("Choose a different destination group");
    }

    const snapshot = await FirestoreTransaction.begin(
      client,
      options.dryRun === true ? "read" : "write"
    );

    try {
      const budget = await client.discover(snapshot);

      if (
        budget.data.id !== client.budgetId ||
        budget.data.type !== "ZERO_BASED" ||
        Object.hasOwn(budget.data, "challengeId") ||
        (budget.data.currentChallenge !== undefined && budget.data.currentChallenge !== null)
      ) {
        throw new Error("Group moves require an identified ordinary zero-based budget");
      }

      const stashId = ObjectIdSchema.parse(client.stashId("GROUPS_AND_CATEGORIES"));

      const index = await snapshot.document(
        `${client.budgetPath}/stashes/${stashId}`,
        z.object({
          data: z.object({
            categories: z.record(z.string(), DataSchema),
            groups: z.record(z.string(), DataSchema),
          }),
          id: z.literal(stashId),
          type: z.literal("GROUPS_AND_CATEGORIES"),
        })
      );

      const { categories, groups } = index.data.data;
      const fromGroup = ordinary(groups, input.fromGroupId);
      const toGroup = ordinary(groups, input.groupId);
      const source = ordinary(categories, input.categoryId);

      if (source.groupId !== input.fromGroupId) {
        throw new Error("Category no longer belongs to the expected source group");
      }

      if (NativeOrderSchema.parse(toGroup.order) <= NativeOrderSchema.parse(fromGroup.order)) {
        throw new Error(
          "Group moves require a later destination group; reverse-direction native placement needs separate evidence"
        );
      }

      if (
        parentOf(source) !== null ||
        (source.target !== undefined && source.target !== null) ||
        (Object.hasOwn(source, "linkedAccountIds") &&
          !z.tuple([]).safeParse(source.linkedAccountIds).success)
      ) {
        throw new Error(
          "Group moves exclude parent links, targets, and stored or unknown account link lists"
        );
      }

      const before = NativeOrderSchema.parse(source.order);
      const after = appendOrder(categories, input);
      const accountsId = ObjectIdSchema.parse(client.stashId("ACCOUNTS"));

      const accounts = await snapshot.document(
        `${client.budgetPath}/stashes/${accountsId}`,
        z.object({
          data: z.record(z.string(), DataSchema),
          id: z.literal(accountsId),
          type: z.literal("ACCOUNTS"),
        })
      );

      for (const [id, account] of Object.entries(accounts.data.data)) {
        const link = z
          .union([z.literal(""), ObjectIdSchema])
          .nullable()
          .safeParse(account.linkedCategoryId);

        if (account.id !== id || !link.success) {
          throw new Error(
            "Group moves require identified accounts with explicit category link evidence"
          );
        }

        if (link.data === input.categoryId) {
          throw new Error("Group moves exclude categories linked from current accounts");
        }
      }

      const result = await this.operations.commit(
        [
          patchDocument(index, [
            { path: ["data", "categories", input.categoryId, "groupId"], value: input.groupId },
            { path: ["data", "categories", input.categoryId, "order"], value: after },
          ]),
        ],
        options,
        snapshot
      );

      return {
        ...result,
        summary: {
          categoryId: input.categoryId,
          directFinancialChanges: false,
          executionSupported: true,
          groupId: { after: input.groupId, before: input.fromGroupId },
          order: { after, before },
          ordering: "append-after-highest-destination-order",
          peerChanges: false,
        },
      };
    } finally {
      try {
        await snapshot.rollback();
      } catch {
        /* Preserve the original operation outcome. */
      }
    }
  }
}
