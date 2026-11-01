/* oxlint-disable func-style -- Native construction and creation validation belong to this workflow. */
import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema, encodeFields, newId, patchDocument } from "../firestore/encoding.ts";
import type { CommitOptions, Data } from "../firestore/encoding.ts";
import { FirestoreTransaction } from "../firestore/transaction.ts";
import { ObjectIdSchema } from "./transaction-model.ts";
import { TransactionOperations } from "./transaction-operations.ts";

export const CategoryCreationSchema = z.strictObject({
  color: z.string().min(1),
  groupId: ObjectIdSchema,
  icon: z.string().min(1),
  name: z.string().trim().min(1).max(200),
});

function appendOrder(
  categories: Record<string, Data>,
  input: z.infer<typeof CategoryCreationSchema>
) {
  let last = -1;
  const orders = new Set<number>();

  for (const [id, category] of Object.entries(categories)) {
    if (category.id !== id || !ObjectIdSchema.safeParse(category.groupId).success) {
      throw new Error(
        "Category creation requires explicit category identities and group membership"
      );
    }

    if (category.groupId !== input.groupId) {
      continue;
    }

    const peerName = z.string().safeParse(category.name);

    if (!peerName.success) {
      throw new Error("Category creation requires explicit peer names");
    }

    if (peerName.data.trim().toLowerCase() === input.name.toLowerCase()) {
      throw new Error("A category with this name already exists in the selected group");
    }

    if (
      category.parentCategoryId !== undefined &&
      category.parentCategoryId !== null &&
      category.parentCategoryId !== ""
    ) {
      throw new Error("Category creation supports flat groups only");
    }

    const order = z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 1)
      .safeParse(category.order);

    if (!order.success || orders.has(order.data)) {
      throw new Error("Category creation requires explicit, unique, safe peer order values");
    }

    orders.add(order.data);
    last = Math.max(last, order.data);
  }

  if (last < 0) {
    throw new Error(
      "Category creation in an empty group requires separate native ordering evidence"
    );
  }

  return last + 1;
}

// Retained native creation snapshots and original three-write acknowledgments establish this
// constructor. These are fields on a NEW record, never defaults for an existing financial record.
function createCategory(input: z.infer<typeof CategoryCreationSchema>, id: string, order: number) {
  return {
    accumulationStrategy: "DEFAULT",
    accumulationStrategyOrder: 0,
    aggregateAllocationForTarget: false,
    amountComputationStrategy: "COMPUTE",
    archived: false,
    archivedAt: null,
    carryOverStrategy: "ALL",
    color: input.color,
    deleted: false,
    groupId: input.groupId,
    hidden: false,
    icon: input.icon,
    id,
    lastTransactionAt: null,
    linkedAccountIds: [],
    lockedForChallenge: true,
    modifiable: true,
    name: input.name,
    nature: "UNCATEGORIZED",
    notes: "",
    order,
    parentCategoryId: "",
    pinned: false,
    subcategoriesCollapsed: false,
    subcategoryAccumulationStrategy: "DEFAULT",
    systemGenerated: false,
    target: null,
    transactionCount: 0,
    type: "DEFAULT",
  };
}

export class CategoryCreationService {
  private readonly client: BeyondClient;
  private readonly operations: TransactionOperations;
  constructor(client: BeyondClient, options: { home?: string } = {}) {
    this.client = client;
    this.operations = new TransactionOperations(client, options);
  }
  async create(value: z.input<typeof CategoryCreationSchema>, options: CommitOptions = {}) {
    const input = CategoryCreationSchema.parse(value);

    return await this.operations.run(
      { action: "create-category", input },
      options,
      async (bound) => await this.execute(input, bound)
    );
  }
  private async execute(input: z.infer<typeof CategoryCreationSchema>, options: CommitOptions) {
    const snapshot = await FirestoreTransaction.begin(
      this.client,
      options.dryRun === true ? "read" : "write"
    );

    try {
      const budget = await this.client.discover(snapshot);

      if (
        budget.data.id !== this.client.budgetId ||
        budget.data.type !== "ZERO_BASED" ||
        Object.hasOwn(budget.data, "challengeId") ||
        (budget.data.currentChallenge !== undefined && budget.data.currentChallenge !== null)
      ) {
        throw new Error("Category creation requires an identified ordinary zero-based budget");
      }

      const stashId = ObjectIdSchema.parse(this.client.stashId("GROUPS_AND_CATEGORIES"));

      const index = await snapshot.document(
        `${this.client.budgetPath}/stashes/${stashId}`,
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
      const group = groups[input.groupId];

      if (
        !group ||
        group.id !== input.groupId ||
        group.type !== "DEFAULT" ||
        group.modifiable !== true ||
        group.deleted === true ||
        group.archived === true
      ) {
        throw new Error(
          "Category creation requires an active DEFAULT group with matching identity and modifiable:true"
        );
      }

      if (
        !Object.values(categories).some((category) => category.icon === input.icon) ||
        !Object.values(categories).some((category) => category.color === input.color)
      ) {
        throw new Error("Choose explicit icon and color values from existing categories");
      }

      const order = appendOrder(categories, input);
      const id = newId();
      const path = `${this.client.budgetPath}/stashes/${id}`;
      const absence = await snapshot.read([path]);

      if (Object.hasOwn(categories, id) || absence.get(path) !== null) {
        throw new Error("Generated category identity already exists");
      }

      const category = createCategory(input, id, order);

      const result = await this.operations.commit(
        [
          patchDocument(index, [{ path: ["data", "categories", id], value: category }]),
          {
            currentDocument: { exists: false },
            update: { fields: encodeFields({ data: {}, id, type: "CATEGORY" }), name: path },
          },
        ],
        options,
        snapshot
      );

      return {
        ...result,
        summary: { category, financialChanges: false, ordering: "append-after-highest-peer-order" },
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
