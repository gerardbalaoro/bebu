/* oxlint-disable func-style -- The target removal boundary owns one named workflow. */
import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema, patchDocument } from "../firestore/encoding.ts";
import type { CommitOptions } from "../firestore/encoding.ts";
import { FirestoreTransaction } from "../firestore/transaction.ts";
import { ObjectIdSchema } from "./transaction-model.ts";

const TargetIndexSchema = z.object({
  data: z.object({ categories: z.record(z.string(), DataSchema) }),
});

const RemovableTargetSchema = z.looseObject({
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  carryOverStrategy: z.enum(["ALL", "NONE"]),
  createdAt: z.string().min(1),
  dayOfMonth: z.null(),
  dayOfWeek: z.null(),
  dynamicSavingsTarget: z.literal(false),
  endAt: z.null(),
  monthOfYear: z.null(),
  period: z.literal("MONTHLY"),
  repeatIntervalMonths: z.null(),
  snoozeSchedule: z.strictObject({}),
  type: z.literal("SPENDING"),
  useAllocatedAmountOnly: z.null(),
});

// Native 77071 → 50485/22150 deletes the complete target without consuming account links.
export async function removeCategoryTarget(
  client: BeyondClient,
  id: string,
  options: CommitOptions = {}
) {
  ObjectIdSchema.parse(id);

  const snapshot = await FirestoreTransaction.begin(
    client,
    options.dryRun === true ? "read" : "write"
  );

  try {
    await client.discover(snapshot);

    const index = await snapshot.document(
      `${client.budgetPath}/stashes/${ObjectIdSchema.parse(client.stashId("GROUPS_AND_CATEGORIES"))}`,
      TargetIndexSchema
    );

    const { categories } = index.data.data;
    const category = categories[id];

    if (category === undefined || category.id !== id) {
      throw new Error("Category not found or stored identity disagrees");
    }

    const hasParent =
      category.parentCategoryId !== undefined &&
      category.parentCategoryId !== null &&
      category.parentCategoryId !== "";

    const hasChildren = Object.values(categories).some((record) => record.parentCategoryId === id);

    if (
      category.type !== "DEFAULT" ||
      category.modifiable !== true ||
      category.archived === true ||
      category.deleted === true ||
      hasParent ||
      hasChildren
    ) {
      throw new Error("Target removal supports active modifiable flat ordinary categories only");
    }

    if (category.target === undefined) {
      return { categoryId: id, changed: false, committed: false };
    }

    const target = DataSchema.parse(category.target);

    if (!RemovableTargetSchema.safeParse(target).success) {
      throw new Error(
        "Target removal currently supports explicit positive monthly spending targets only"
      );
    }

    const summary = {
      categoryId: id,
      directFundingChanges: false,
      futureTargetDemand: "removed",
      previousTarget: target,
    };

    const result = await client.commit(
      [patchDocument(index, [{ path: ["data", "categories", id, "target"], value: undefined }])],
      options,
      snapshot
    );

    if ("alreadyCommitted" in result) {
      throw new Error(
        "Target removal has marker-only confirmation. Inspect the current target before another command"
      );
    }

    return { ...result, changed: true, summary };
  } finally {
    try {
      await snapshot.rollback();
    } catch {
      /* Preserve the original outcome. */
    }
  }
}
