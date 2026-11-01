/* oxlint-disable func-style -- Named domain validations precede the shared native hierarchy workflow. */
import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema, patchDocument } from "../firestore/encoding.ts";
import type { CommitOptions, Data } from "../firestore/encoding.ts";
import { FirestoreTransaction } from "../firestore/transaction.ts";
import { ObjectIdSchema } from "./transaction-model.ts";

export const CategoryParentChangeSchema = z.strictObject({
  action: z.enum(["attach", "detach"]),
  categoryId: ObjectIdSchema,
  parentId: ObjectIdSchema,
});

const IndexSchema = z.object({
  data: z.object({
    categories: z.record(z.string(), DataSchema),
    groups: z.record(z.string(), DataSchema),
  }),
});

const AccountIndexSchema = z.object({ data: z.record(z.string(), DataSchema) });

const OrdinarySchema = z.looseObject({
  archived: z.literal(false).optional(),
  deleted: z.literal(false).optional(),
  id: ObjectIdSchema,
  modifiable: z.literal(true),
  name: z.string(),
  type: z.literal("DEFAULT"),
});

const AccountLinkSchema = z.looseObject({
  id: ObjectIdSchema,
  linkedCategoryId: z.string().nullable(),
});

function parentOf(category: Data) {
  const parent = z.string().nullable().optional().parse(category.parentCategoryId);

  return parent === undefined || parent === null || parent === ""
    ? null
    : ObjectIdSchema.parse(parent);
}

function ordinary(records: Record<string, Data>, id: string) {
  if (!Object.hasOwn(records, id)) {
    throw new Error("Hierarchy category or group not found");
  }

  const record = records[id];

  if (record?.id !== id) {
    throw new Error("Hierarchy stored identity disagrees with its map key");
  }

  const parsed = OrdinarySchema.safeParse(record);

  if (!parsed.success) {
    throw new Error(
      "Hierarchy writes support active DEFAULT records with explicit modifiable:true only"
    );
  }

  return parsed.data;
}

function orderOf(category: Data) {
  const order = z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .safeParse(category.order);

  if (!order.success) {
    throw new Error("Hierarchy writes require an explicit nonnegative safe integer order");
  }

  return order.data;
}

function validateGroupGraph(
  categories: Record<string, Data>,
  groupId: string,
  change: z.infer<typeof CategoryParentChangeSchema>
) {
  const orders = new Set<string>();

  for (const [id, category] of Object.entries(categories)) {
    if (category.id !== id) {
      throw new Error("Hierarchy stored identity disagrees with its map key");
    }

    const parent = parentOf(category);

    if (parent !== null) {
      const parentRecord = Object.hasOwn(categories, parent) ? categories[parent] : undefined;

      if (
        parentRecord === undefined ||
        parent === id ||
        parentRecord.groupId !== category.groupId ||
        parentOf(parentRecord) !== null
      ) {
        throw new Error("Hierarchy must resolve to one level within the same group");
      }
    }

    if (parent === change.categoryId) {
      throw new Error("Hierarchy source category must not have children");
    }

    if (category.groupId !== groupId) {
      continue;
    }

    if (category.archived === true || category.deleted === true) {
      continue;
    }

    const intendedParent = change.action === "attach" ? change.parentId : null;
    const nextParent = id === change.categoryId ? intendedParent : parent;
    const key = JSON.stringify([nextParent, orderOf(category)]);

    if (orders.has(key)) {
      throw new Error(
        "Hierarchy change would produce ambiguous sibling order; use native ordering first"
      );
    }

    orders.add(key);
  }
}

function validateFamily(family: Record<string, Data>, accounts: Record<string, Data>) {
  for (const [id, record] of Object.entries(family)) {
    ordinary(family, id);

    if (
      [
        "target",
        "aggregateAllocationForTarget",
        "accumulationStrategy",
        "computationStrategy",
      ].some((key) => Object.hasOwn(record, key))
    ) {
      throw new Error(
        "Hierarchy writes exclude target, aggregation, accumulation, and computation settings"
      );
    }

    if (
      Object.hasOwn(record, "linkedAccountIds") &&
      !z.tuple([]).safeParse(record.linkedAccountIds).success
    ) {
      throw new Error("Hierarchy writes exclude stored or unknown linked account lists");
    }
  }

  for (const [id, raw] of Object.entries(accounts)) {
    const parsed = AccountLinkSchema.safeParse(raw);

    if (!parsed.success) {
      throw new Error("Hierarchy writes require explicit account link evidence for every account");
    }

    const account = parsed.data;

    if (account.id !== id) {
      throw new Error("Account identity disagrees with its map key");
    }

    if (account.linkedCategoryId === null || account.linkedCategoryId === "") {
      continue;
    }

    const linked = ObjectIdSchema.parse(account.linkedCategoryId);

    if (Object.hasOwn(family, linked)) {
      throw new Error("Hierarchy writes exclude families with a linked account");
    }
  }
}

// Native detach 50481 deletes the parent field; attach 50482 writes parent and group, never order.
export async function changeCategoryParent(
  client: BeyondClient,
  input: z.input<typeof CategoryParentChangeSchema>,
  options: CommitOptions = {}
) {
  const change = CategoryParentChangeSchema.parse(input);
  const { action, categoryId, parentId } = change;

  if (categoryId === parentId) {
    throw new Error("Child and parent must be different categories");
  }

  const snapshot = await FirestoreTransaction.begin(
    client,
    options.dryRun === true ? "read" : "write"
  );

  try {
    const budget = await client.discover(snapshot);

    const [index, accountIndex] = await Promise.all([
      snapshot.document(
        `${client.budgetPath}/stashes/${ObjectIdSchema.parse(client.stashId("GROUPS_AND_CATEGORIES"))}`,
        IndexSchema
      ),
      snapshot.document(
        `${client.budgetPath}/stashes/${ObjectIdSchema.parse(client.stashId("ACCOUNTS"))}`,
        AccountIndexSchema
      ),
    ]);

    const { categories, groups } = index.data.data;
    const child = ordinary(categories, categoryId);
    const parent = ordinary(categories, parentId);
    const groupId = ObjectIdSchema.parse(child.groupId);

    if (parent.groupId !== groupId) {
      throw new Error("Hierarchy writes support the same group only");
    }

    ordinary(groups, groupId);
    const previousParent = parentOf(child);

    if (parentOf(parent) !== null) {
      throw new Error("Hierarchy parent must be top-level; only one level is supported");
    }

    if (action === "detach" && previousParent !== parentId) {
      throw new Error(
        "Current parent disagrees with the expected parent; inspect the current hierarchy"
      );
    }

    if (action === "attach" && previousParent !== null) {
      throw new Error("Attach requires a top-level source; existing parents cannot be replaced");
    }

    validateGroupGraph(categories, groupId, change);

    const family = Object.fromEntries(
      Object.entries(categories).filter(
        ([id, record]) =>
          id === categoryId || id === parentId || record.parentCategoryId === parentId
      )
    );

    validateFamily(family, accountIndex.data.data);

    const summary = {
      categoryId,
      directFundingChanges: false,
      familyIds: Object.keys(family).toSorted(),
      fundingOutcomesPredicted: false,
      groupId,
      order: orderOf(child),
      parent: { after: action === "attach" ? parentId : null, before: previousParent },
      parentCoverageMembership: action === "attach" ? "added" : "removed",
      sources: [budget, index, accountIndex].map((document) => ({
        document: document.name,
        updateTime: document.updateTime,
      })),
    };

    const changes = [
      {
        path: ["data", "categories", categoryId, "parentCategoryId"],
        value: action === "detach" ? undefined : parentId,
      },
    ];

    if (action === "attach") {
      changes.push({ path: ["data", "categories", categoryId, "groupId"], value: groupId });
    }

    const result = await client.commit([patchDocument(index, changes)], options, snapshot);

    if ("alreadyCommitted" in result) {
      throw new Error(
        "Hierarchy write has marker-only confirmation. Inspect the current hierarchy before another command"
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
