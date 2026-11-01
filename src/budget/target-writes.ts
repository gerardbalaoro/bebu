/* oxlint-disable func-style -- Named entry points share the native whole-target write boundary. */
import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema, patchDocument } from "../firestore/encoding.ts";
import type { CommitOptions, FirestoreDocument } from "../firestore/encoding.ts";
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

const WritableTargetSchema = RemovableTargetSchema.strict().extend({
  createdAt: z.iso.datetime({ offset: true }).regex(/:\d{2}(?:\.0+)?(?:Z|[+-]\d{2}:\d{2})$/u),
});

export const TargetSettingsSchema = z.strictObject({
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  carryOverStrategy: z.enum(["ALL", "NONE"]),
});

type TargetChange =
  | { action: "remove" }
  | { action: "create" | "update"; settings: z.infer<typeof TargetSettingsSchema> };

function validateTargetTimestamp(index: FirestoreDocument<unknown>, id: string) {
  let { fields } = index.raw;

  for (const key of ["data", "categories", id, "target"]) {
    ({ fields } = z
      .object({ mapValue: z.object({ fields: DataSchema }) })
      .parse(fields[key]).mapValue);
  }

  if (!z.object({ timestampValue: z.string() }).safeParse(fields.createdAt).success) {
    throw new Error("Target editing requires a native createdAt timestamp, not a legacy string");
  }
}

function planTargetChange(category: z.infer<typeof DataSchema>, change: TargetChange) {
  const previousTarget = category.target;
  let target: z.infer<typeof WritableTargetSchema> | undefined;

  if (change.action === "create") {
    if (Object.hasOwn(category, "target")) {
      throw new Error("Category already has a target field; inspect it before creating a target");
    }

    // Native 77068/44701 initializes createdAt from the current clock. Both settings are explicit CLI inputs.
    target = {
      amount: change.settings.amountMinor,
      carryOverStrategy: change.settings.carryOverStrategy,
      createdAt: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
      dayOfMonth: null,
      dayOfWeek: null,
      dynamicSavingsTarget: false,
      endAt: null,
      monthOfYear: null,
      period: "MONTHLY",
      repeatIntervalMonths: null,
      snoozeSchedule: {},
      type: "SPENDING",
      useAllocatedAmountOnly: null,
    };
  } else if (change.action === "update") {
    if (previousTarget === undefined || previousTarget === null) {
      throw new Error("Target update requires an existing target");
    }

    // Native spending decoder 49244 rebuilds createdAt from the clock; 49243 saves it. Unknown fields stay guarded.
    const parsed = WritableTargetSchema.safeParse(previousTarget);

    if (!parsed.success) {
      throw new Error(
        "Target editing supports complete known positive monthly spending targets only"
      );
    }

    target = {
      ...parsed.data,
      amount: change.settings.amountMinor,
      carryOverStrategy: change.settings.carryOverStrategy,
      createdAt: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
    };

    if (
      target.amount === parsed.data.amount &&
      target.carryOverStrategy === parsed.data.carryOverStrategy
    ) {
      return { changed: false, target: undefined };
    }
  } else {
    if (previousTarget === undefined) {
      return { changed: false, target: undefined };
    }

    if (!RemovableTargetSchema.safeParse(previousTarget).success) {
      throw new Error(
        "Target removal currently supports explicit positive monthly spending targets only"
      );
    }
  }

  return { changed: true, target };
}

// Native 50485 replaces the complete target via 49243, or deletes it via 22150.
async function changeCategoryTarget(
  client: BeyondClient,
  id: string,
  change: TargetChange,
  options: CommitOptions
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
      throw new Error("Target writes support active modifiable flat ordinary categories only");
    }

    const plan = planTargetChange(category, change);

    if (!plan.changed) {
      return { categoryId: id, changed: false, committed: false };
    }

    const { target } = plan;
    const previousTarget = category.target;

    if (change.action === "update") {
      validateTargetTimestamp(index, id);
    }

    const summary = {
      categoryId: id,
      directFundingChanges: false,
      futureTargetDemand: change.action === "remove" ? "removed" : "changed",
      previousTarget: previousTarget ?? null,
      target: target ?? null,
    };

    const result = await client.commit(
      [
        patchDocument(index, [
          {
            path: ["data", "categories", id, "target"],
            value:
              target === undefined
                ? undefined
                : { ...target, createdAt: new Date(target.createdAt) },
          },
        ]),
      ],
      options,
      snapshot
    );

    if ("alreadyCommitted" in result) {
      throw new Error(
        "Target write has marker-only confirmation. Inspect the current target before another command"
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

export async function removeCategoryTarget(
  client: BeyondClient,
  id: string,
  options: CommitOptions = {}
) {
  return await changeCategoryTarget(client, id, { action: "remove" }, options);
}

export async function saveCategoryTarget(
  client: BeyondClient,
  id: string,
  action: "create" | "update",
  input: z.input<typeof TargetSettingsSchema>,
  options: CommitOptions = {}
) {
  z.enum(["create", "update"]).parse(action);
  const settings = TargetSettingsSchema.parse(input);

  return await changeCategoryTarget(client, id, { action, settings }, options);
}
