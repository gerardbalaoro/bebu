/* oxlint-disable complexity, func-style, no-await-in-loop -- Archive validation and snapshot queries precede one metadata-only commit. */
import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema, DocumentRoot, patchDocument } from "../firestore/encoding.ts";
import type { CommitOptions, Data } from "../firestore/encoding.ts";
import { FirestoreTransaction } from "../firestore/transaction.ts";
import { ObjectIdSchema } from "./transaction-model.ts";
import { TransactionOperations } from "./transaction-operations.ts";

export const CategoryArchiveSchema = z.strictObject({
  categoryId: ObjectIdSchema,
  month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u),
});

const QueryLimit = 10_000;

function ordinary(record: Data | undefined, id: string) {
  if (
    !record ||
    record.id !== id ||
    record.type !== "DEFAULT" ||
    record.modifiable !== true ||
    !z.literal(false).optional().safeParse(record.archived).success ||
    !z.literal(false).optional().safeParse(record.deleted).success
  ) {
    throw new Error("Archive requires identified active modifiable DEFAULT categories and groups");
  }

  return record;
}

function hasReference(record: Data, id: string) {
  return ["targetFrom", "targetTo", "extraTarget"].some((key) => {
    const target = record[key];

    const nested =
      target === undefined || target === null
        ? null
        : z.object({ id: ObjectIdSchema }).parse(target).id;

    const flattened = z.string().nullish().parse(record[`${key}Id`]);

    return nested === id || flattened === id;
  });
}

function rejectUpcoming(records: Record<string, Data>, categoryId: string, categoryStash = false) {
  for (const [id, record] of Object.entries(records)) {
    if (record.id !== id) {
      throw new Error("Archive found an inconsistent upcoming identity");
    }

    if (categoryStash || hasReference(record, categoryId)) {
      throw new Error("Archive requires no upcoming obligations or templates for this category");
    }
  }
}

export class CategoryArchiveService {
  private readonly client: BeyondClient;
  private readonly operations: TransactionOperations;
  constructor(client: BeyondClient, options: { home?: string } = {}) {
    this.client = client;
    this.operations = new TransactionOperations(client, options);
  }
  async archive(value: z.input<typeof CategoryArchiveSchema>, options: CommitOptions = {}) {
    const input = CategoryArchiveSchema.parse(value);

    return await this.operations.run(
      { action: "archive-category", input },
      options,
      async (bound) => await this.execute(input, bound)
    );
  }
  private async execute(input: z.infer<typeof CategoryArchiveSchema>, options: CommitOptions) {
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
        throw new Error("Archive requires an identified ordinary zero-based budget");
      }

      const user = await snapshot.document(
        `${DocumentRoot}/users/${this.client.session.uid}`,
        z.object({ config: z.object({ timezone: z.string().min(1) }) })
      );

      const archivedAt = new Date();

      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
          month: "2-digit",
          timeZone: user.data.config.timezone,
          year: "numeric",
        })
          .formatToParts(archivedAt)
          .map((part) => [part.type, part.value])
      );

      if (input.month !== `${parts.year}-${parts.month}`) {
        throw new Error("Archive supports the current month in the saved user timezone only");
      }

      const readStash = async (id: string, type: string) =>
        await snapshot.document(
          `${this.client.budgetPath}/stashes/${ObjectIdSchema.parse(id)}`,
          z.object({ data: DataSchema, id: z.literal(id), type: z.literal(type) })
        );

      const index = await readStash(
        this.client.stashId("GROUPS_AND_CATEGORIES"),
        "GROUPS_AND_CATEGORIES"
      );

      const categories = z.record(z.string(), DataSchema).parse(index.data.data.categories);
      const groups = z.record(z.string(), DataSchema).parse(index.data.data.groups);
      const category = ordinary(categories[input.categoryId], input.categoryId);
      const groupId = ObjectIdSchema.parse(category.groupId);
      ordinary(groups[groupId], groupId);

      if (category.target !== undefined && category.target !== null) {
        throw new Error("Remove the category target before archiving");
      }

      if (
        Object.hasOwn(category, "linkedAccountIds") &&
        !z.tuple([]).safeParse(category.linkedAccountIds).success
      ) {
        throw new Error("Archive excludes explicit or malformed category account links");
      }

      for (const [id, record] of Object.entries(categories)) {
        if (record.id !== id) {
          throw new Error("Archive found inconsistent category identities");
        }

        const parent = z.string().nullish().parse(record.parentCategoryId);

        if (parent === input.categoryId) {
          throw new Error("Archive requires a childless category");
        }
      }

      const parent = z.string().nullish().parse(category.parentCategoryId);

      if (parent !== undefined && parent !== null && parent !== "") {
        const parentRecord = ordinary(categories[ObjectIdSchema.parse(parent)], parent);

        if (parentRecord.groupId !== groupId || Boolean(parentRecord.parentCategoryId)) {
          throw new Error("Archive supports a direct parent in the same group only");
        }
      }

      const accounts = await readStash(this.client.stashId("ACCOUNTS"), "ACCOUNTS");

      for (const [id, account] of Object.entries(
        z.record(z.string(), DataSchema).parse(accounts.data.data)
      )) {
        if (account.id !== id) {
          throw new Error("Archive found inconsistent account identities");
        }
        // Native archive does not consume absent account links; preserve them without interpretation.

        const link = z.string().nullish().parse(account.linkedCategoryId);

        if (link === input.categoryId) {
          throw new Error("Archive excludes explicitly linked accounts");
        }
      }

      const categoryStash = await readStash(input.categoryId, "CATEGORY");

      if (Object.hasOwn(categoryStash.data.data, "upcomingTransactions")) {
        rejectUpcoming(
          z.record(z.string(), DataSchema).parse(categoryStash.data.data.upcomingTransactions),
          input.categoryId,
          true
        );
      }

      const transactions = await readStash(this.client.stashId("TRANSACTIONS"), "TRANSACTIONS");
      rejectUpcoming(
        z.record(z.string(), DataSchema).parse(transactions.data.data.upcomingTransactions),
        input.categoryId
      );

      const templates = await readStash(
        this.client.stashId("TRANSACTION_TEMPLATES"),
        "TRANSACTION_TEMPLATES"
      );

      rejectUpcoming(z.record(z.string(), DataSchema).parse(templates.data.data), input.categoryId);
      const historicalMatches = new Set<string>();

      for (const field of ["targetFrom.id", "targetTo.id", "extraTarget.id"]) {
        const records = await snapshot.query("transactions", field, input.categoryId, QueryLimit);

        if (records.length === QueryLimit) {
          throw new Error("Archive canonical reference scan reached its limit");
        }

        for (const record of records) {
          const id = record.name.slice(record.name.lastIndexOf("/") + 1);

          if (
            record.data.id !== id ||
            record.data.budgetId !== this.client.budgetId ||
            !hasReference(record.data, input.categoryId) ||
            record.data.completed !== true
          ) {
            throw new Error(
              "Archive canonical references must have matching identities and explicit completed:true"
            );
          }

          historicalMatches.add(id);
        }
      }

      const result = await this.operations.commit(
        [
          patchDocument(index, [
            { path: ["data", "categories", input.categoryId, "archived"], value: true },
            { path: ["data", "categories", input.categoryId, "archivedAt"], value: archivedAt },
            {
              path: ["data", "categories", input.categoryId, "parentCategoryId"],
              value: undefined,
            },
          ]),
        ],
        options,
        snapshot
      );

      return {
        ...result,
        summary: {
          archivedAt: archivedAt.toISOString(),
          categoryId: input.categoryId,
          financialChanges: false,
          fundsEvaluated: false,
          historicalReferenceMatches: historicalMatches.size,
          month: input.month,
          previousParentId: parent ?? null,
          sources: [budget, user, index, accounts, categoryStash, transactions, templates].map(
            (doc) => ({ document: doc.name, updateTime: doc.updateTime })
          ),
          upcomingRewriteOmitted: true,
        },
      };
    } finally {
      try {
        await snapshot.rollback();
      } catch {
        /* Preserve the original outcome. */
      }
    }
  }
}
