/* oxlint-disable func-style -- Named validations keep the native append contract explicit. */
import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema, patchDocument } from "../firestore/encoding.ts";
import type { Data } from "../firestore/encoding.ts";
import { FirestoreTransaction } from "../firestore/transaction.ts";
import { ObjectIdSchema } from "./transaction-model.ts";

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
      "Group move previews require identified active modifiable DEFAULT categories and groups"
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
      throw new Error(
        "Group move previews require explicit category identities and group membership"
      );
    }

    if (parentOf(category) === input.categoryId) {
      throw new Error("Group move previews exclude categories with children");
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
        throw new Error("Group move previews require a flat destination group");
      }

      last = Math.max(last, order);
    }
  }

  if (last < 0 || last === 2_147_483_647) {
    throw new Error(
      "Group move previews require a nonempty destination with room in the native order range"
    );
  }

  return last + 1;
}

// Native 65933/65939 append after the final destination category. Writer 50490 preserves
// strictly increasing peer orders and patches groupId/order. Runtime validation is still required.
export async function previewCategoryGroupMove(
  client: BeyondClient,
  value: z.input<typeof CategoryGroupMoveSchema>
) {
  const input = CategoryGroupMoveSchema.parse(value);

  if (input.fromGroupId === input.groupId) {
    throw new Error("Choose a different destination group");
  }

  const snapshot = await FirestoreTransaction.begin(client, "read");

  try {
    const budget = await client.discover(snapshot);

    if (
      budget.data.id !== client.budgetId ||
      budget.data.type !== "ZERO_BASED" ||
      Object.hasOwn(budget.data, "challengeId") ||
      (budget.data.currentChallenge !== undefined && budget.data.currentChallenge !== null)
    ) {
      throw new Error("Group move previews require an identified ordinary zero-based budget");
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
        "Group move previews require a later destination group; reverse-direction native placement needs separate evidence"
      );
    }

    if (
      parentOf(source) !== null ||
      (source.target !== undefined && source.target !== null) ||
      (Object.hasOwn(source, "linkedAccountIds") &&
        !z.tuple([]).safeParse(source.linkedAccountIds).success)
    ) {
      throw new Error(
        "Group move previews exclude parent links, targets, and stored or unknown account link lists"
      );
    }

    const before = NativeOrderSchema.parse(source.order);
    const after = appendOrder(categories, input);

    const result = await client.commit(
      [
        patchDocument(index, [
          { path: ["data", "categories", input.categoryId, "groupId"], value: input.groupId },
          { path: ["data", "categories", input.categoryId, "order"], value: after },
        ]),
      ],
      { dryRun: true },
      snapshot
    );

    return {
      ...result,
      summary: {
        categoryId: input.categoryId,
        executionSupported: false,
        groupId: { after: input.groupId, before: input.fromGroupId },
        order: { after, before },
        ordering: "append-after-highest-destination-order",
        peerChanges: false,
        validationRequired:
          "Native and deployed CLI lab validation; no live group-move writer is enabled",
      },
    };
  } finally {
    try {
      await snapshot.rollback();
    } catch {
      /* Preserve the preview's original failure. No write transaction was opened. */
    }
  }
}
