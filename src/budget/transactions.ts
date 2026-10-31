/* oxlint-disable complexity, max-classes-per-file, no-await-in-loop -- Keep atomic ledger planning and its ordered updates together. */
/* oxlint-disable anti-slop/no-unknown-returns, anti-slop/no-runtime-typeof -- Nested Firestore traversal checks raw fields before numeric or existence validation. */
import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { encodeFields, fieldPath, newId, patchDocument } from "../firestore/encoding.ts";
import type {
  CommitOptions,
  Data,
  FieldChange,
  FirestoreDocument,
  Write,
} from "../firestore/encoding.ts";
import { AccountsSchema } from "./accounts.ts";
import { requireIndependentTransaction } from "./allocation-effects.ts";
import { LabelsSchema } from "./labels.ts";
import { CategoriesSchema } from "./model.ts";
import { editTransaction } from "./transaction-edit.ts";
import {
  transactionIndexPaths,
  transactionPreview,
  updateTransactionIndexes,
} from "./transaction-index.ts";
import { applyTransactionLedger } from "./transaction-ledger.ts";
import {
  CollectionSchema,
  ObjectIdSchema,
  QueryRowsSchema,
  TransactionCreateSchema,
  TransactionPatchSchema,
  TransactionSchema,
  UserSchema,
  decodeTransaction,
} from "./transaction-model.ts";
import type {
  Target,
  Transaction,
  TransactionCreate,
  TransactionPatch,
} from "./transaction-model.ts";
import { transactionSummary } from "./transaction-summary.ts";
import { makeTarget } from "./transaction-target.ts";

export type TransactionContext = Awaited<ReturnType<TransactionService["context"]>>;

const requireId = (id: string): string => ObjectIdSchema.parse(id);

// Each consumer validates nested Firestore paths for numeric values or existence.
const get = (object: Data, path: string[]): unknown => {
  let value: unknown = object;

  for (const key of path) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    value = Object.getOwnPropertyDescriptor(value, key)?.value;
  }

  return value;
};

interface PlanEntry {
  doc: FirestoreDocument;
  changes: Map<string, FieldChange>;
  increments: Map<string, number>;
}

export class MutationPlan {
  private readonly docs = new Map<string, PlanEntry>();
  readonly extra: Write[] = [];
  readonly client: BeyondClient;

  constructor(client: BeyondClient) {
    this.client = client;
  }
  async entry(name: string): Promise<PlanEntry> {
    const existing = this.docs.get(name);

    if (existing) {
      return existing;
    }

    const entry = {
      changes: new Map<string, FieldChange>(),
      doc: await this.client.document(name),
      increments: new Map<string, number>(),
    };

    this.docs.set(name, entry);

    return entry;
  }
  async set(name: string, path: string[], value: FieldChange["value"]): Promise<void> {
    const entry = await this.entry(name);
    entry.changes.set(fieldPath(...path), { path, value });
  }
  async increment(name: string, path: string[], amount: number): Promise<void> {
    if (!Number.isSafeInteger(amount)) {
      throw new TypeError("Money and counters must be safe integers");
    }

    if (!amount) {
      return;
    }

    const entry = await this.entry(name);
    const field = fieldPath(...path);
    const existing = get(entry.doc.data, path);
    const numeric = z.number().int().safeParse(existing);
    const accumulated = (entry.increments.get(field) ?? 0) + amount;

    if (
      existing !== undefined &&
      (!numeric.success || !Number.isSafeInteger(numeric.data + accumulated))
    ) {
      throw new Error("Unsafe numeric field");
    }

    if (!Number.isSafeInteger(accumulated)) {
      throw new TypeError("Unsafe numeric increment");
    }

    entry.increments.set(field, accumulated);
  }
  amountChange(name: string, path: string[]) {
    const entry = this.docs.get(name);
    let change: { after: number; before: number; delta: number } | undefined;

    if (entry !== undefined) {
      const before = z
        .number()
        .int()
        .parse(get(entry.doc.data, path) ?? 0);

      const delta = entry.increments.get(fieldPath(...path)) ?? 0;
      const after = before + delta;

      if (!Number.isSafeInteger(after)) {
        throw new TypeError("The resulting amount must be a safe integer");
      }

      change = { after, before, delta };
    }

    return change;
  }
  writes(): Write[] {
    const writes = [...this.extra];

    for (const { doc, changes, increments } of this.docs.values()) {
      const active = [...increments].filter(([, amount]) => amount !== 0);

      if (!(changes.size || active.length)) {
        continue;
      }

      const write = patchDocument(doc, [...changes.values()]);

      if (active.length) {
        write.updateTransforms = active.map(([path, amount]) => ({
          fieldPath: path,
          increment: { integerValue: String(amount) },
        }));
      }

      writes.push(write);
    }

    return writes;
  }
}

const supported = (transaction: Transaction): void => {
  if (!["OUTFLOW", "INFLOW"].includes(transaction.type)) {
    throw new Error(
      `bebu changes only expenses and income. The ${transaction.type} type requires a separate ledger flow`
    );
  }

  if (
    Boolean(transaction.splitId) ||
    Boolean(transaction.siblingTransactionId) ||
    Boolean(transaction.clonedToTransactionId) ||
    Boolean(transaction.subType) ||
    transaction.extraTarget ||
    Object.keys(transaction.extras).length ||
    transaction.files?.length
  ) {
    throw new Error(
      "The transaction has links, splits, files, or extra behavior that bebu does not support"
    );
  }

  if (transaction.reconciled) {
    throw new Error("Remove the reconciliation in the app before this change");
  }
};

const validateAmount = (amount: number): void => {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(
      "amountMinor must be a positive integer in minor units of the account currency"
    );
  }
};

export class TransactionService {
  readonly client: BeyondClient;

  constructor(client: BeyondClient) {
    this.client = client;
  }
  async context() {
    const budget = await this.client.discover();

    const [accounts, categories, user] = await Promise.all([
      this.client.stash("ACCOUNTS", AccountsSchema),
      this.client.stash("GROUPS_AND_CATEGORIES", CategoriesSchema),
      this.client.document(
        `projects/beyond-budget/databases/(default)/documents/users/${this.client.session.uid}`,
        UserSchema
      ),
    ]);

    return {
      accountMap: accounts.data.data,
      accounts,
      budget,
      categories,
      categoryMap: categories.data.data.categories,
      user: user.data,
    };
  }
  async transaction(id: string) {
    requireId(id);

    return await this.client.document(
      `${this.client.budgetPath}/transactions/${id}`,
      TransactionSchema
    );
  }
  async create(value: TransactionCreate, options: CommitOptions = {}) {
    const input = TransactionCreateSchema.parse(value);
    validateAmount(input.amountMinor);
    const context = await this.context();

    const timezone =
      [input.timezone, context.user.config?.timezone].find(
        (candidate) => candidate !== undefined && candidate !== ""
      ) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

    const dueAt = new Date(input.dueAt ?? Date.now());

    if (!Number.isFinite(dueAt.getTime())) {
      throw new TypeError("dueAt is invalid. Use an ISO timestamp with a timezone");
    }

    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        day: "2-digit",
        month: "2-digit",
        timeZone: timezone,
        year: "numeric",
      })
        .formatToParts(dueAt)
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, p.value])
    );

    const yearMonth = `${parts.year}-${parts.month}`;
    const periodId = context.budget.data.availablePeriods?.[yearMonth]?.id;

    if (periodId === undefined || periodId === "") {
      throw new Error(
        `Budget period ${yearMonth} does not exist. Create or select that period in the app`
      );
    }

    const { type } = input;
    let targetFrom: Target | null = null;
    let targetTo: Target | null = null;

    if (type === "OUTFLOW") {
      targetFrom = makeTarget(input.accountId, "account", context.accountMap, context.categoryMap);
      targetTo = makeTarget(
        input.categoryId ?? "",
        "category",
        context.accountMap,
        context.categoryMap
      );
    } else if (type === "INFLOW") {
      targetTo = makeTarget(input.accountId, "account", context.accountMap, context.categoryMap);

      if (targetTo.type === "CREDIT_CARD") {
        throw new Error(
          "bebu does not support credit card refunds. Refunds require a separate ledger flow"
        );
      }
    } else {
      throw new Error("Use OUTFLOW or INFLOW to create a transaction");
    }

    const completed = input.completed ?? dueAt.getTime() <= Date.now();

    if (completed && dueAt.getTime() > Date.now() + 60_000) {
      throw new Error("A future transaction must have completed=false");
    }

    const id = requireId(input.id ?? options.requestId ?? newId());
    let payee: Target | null = null;

    if (input.payeeId !== undefined) {
      const stashResult = await this.client.stash("PAYEES", LabelsSchema);
      const payees = stashResult.data.data;
      const p = payees[input.payeeId];

      if (!p || p.archived === true) {
        throw new Error("Payee not found");
      }

      payee = { id: p.id, linkedObjectId: null, linkedObjectType: null, type: "PAYEE" };
    }

    const tagIds = input.tagIds ?? [];

    if (!Array.isArray(tagIds) || new Set(tagIds).size !== tagIds.length) {
      throw new Error("tagIds must be a list of unique IDs");
    }

    if (tagIds.length) {
      const stashResult1 = await this.client.stash("TAGS", LabelsSchema);
      const tags = stashResult1.data.data;

      for (const tagId of tagIds) {
        if (!tags[tagId] || tags[tagId].archived === true) {
          throw new Error("Tag not found");
        }
      }
    }

    const palette = new Set([
      "NONE",
      ...Object.values(context.accountMap).map((v) => v.color),
      ...Object.values(context.categoryMap).map((v) => v.color),
    ]);

    if (input.color !== undefined && !palette.has(input.color)) {
      throw new Error("Choose a color value from an existing account or category");
    }

    const account = context.accountMap[input.accountId];

    if (
      account?.currencyCode !== undefined &&
      account.currencyCode !== "" &&
      account.currencyCode !== context.user.config?.currencyCode
    ) {
      throw new Error("bebu does not support changes to foreign-currency transactions");
    }

    const transaction: Transaction = {
      amount: type === "INFLOW" ? input.amountMinor : -input.amountMinor,
      autoAllocateIfCapable: false,
      autoAllocateIfIncome: false,
      budgetId: this.client.budgetId,
      cleared: input.cleared ?? true,
      clonedToTransactionId: null,
      color: input.color === undefined || input.color === "" ? "NONE" : input.color,
      completed,
      createdAt: new Date().toISOString(),
      createdBy: {
        displayName: context.user.displayName ?? "",
        email: null,
        photoUrl: context.user.photoUrl ?? "",
        uid: this.client.session.uid,
      },
      dueAt: dueAt.toISOString(),
      editable: true,
      eventId: null,
      externalId: null,
      extraTarget: null,
      extras: {},
      files: [],
      frequency: "ONE_OFF",
      id,
      integrityCount: 1,
      latitude: null,
      longitude: null,
      nonWorkingDayPolicy: "KEEP_ORIGINAL_DATE",
      notes: input.notes ?? "",
      offsetAdjustment: 0,
      payee,
      periodId,
      reconciled: false,
      reconciledAt: null,
      reminderDescription: null,
      reminderEnabled: false,
      reminderName: null,
      repeatCount: null,
      sentiment: "NONE",
      sequenceCount: null,
      siblingTransactionId: null,
      splitId: null,
      subType: null,
      tagIds,
      targetFrom,
      targetTo,
      timezone,
      type,
      version: completed ? 1 : null,
      yearMonth,
    };

    const plan = new MutationPlan(this.client);

    const wire = {
      ...transaction,
      createdAt: new Date(transaction.createdAt),
      dueAt: new Date(transaction.dueAt),
    };

    plan.extra.push({
      currentDocument: { exists: false },
      update: { fields: encodeFields(wire), name: `${this.client.budgetPath}/transactions/${id}` },
    });
    await this.apply(plan, transaction, 1, context);

    const summary =
      options.dryRun === true ? transactionSummary(plan, null, transaction) : undefined;

    const result = await this.client.commit(plan.writes(), options);

    return { ...result, automaticAllocation: false, summary, transactionId: id };
  }
  async apply(
    plan: MutationPlan,
    transaction: Transaction,
    direction: 1 | -1,
    context: TransactionContext
  ) {
    supported(transaction);

    if (transaction.frequency !== "ONE_OFF") {
      throw new Error("Creating or deleting a recurring transaction requires the native app");
    }

    if (transaction.periodId === undefined || transaction.periodId === null) {
      throw new Error("The transaction has no budget period. Select its month in the app");
    }

    await applyTransactionLedger(plan, transaction, direction, context);
    const accountPath = context.accounts.name;
    const categoryPath = context.categories.name;

    const increment = async (name: string, path: string[], amount: number) => {
      await plan.increment(name, path, amount);
    };

    const accountTargets = [transaction.targetFrom, transaction.targetTo].filter(
      (target): target is Target => target !== null && target.type !== "CATEGORY"
    );

    const categoryTargets = [transaction.targetFrom, transaction.targetTo].filter(
      (target): target is Target => target !== null && target.type === "CATEGORY"
    );

    const bucket = transaction.completed ? "completedTransactions" : "upcomingTransactions";
    const paths = transactionIndexPaths(this.client, transaction);

    for (const path of paths) {
      const entry = await plan.entry(path);

      const hasPreview = Boolean(get(entry.doc.data, ["data", bucket, transaction.id]));

      if (direction < 0 && !hasPreview) {
        continue;
      }

      await plan.set(
        path,
        ["data", bucket, transaction.id],
        direction > 0 ? transactionPreview(transaction) : undefined
      );

      if (
        transaction.completed &&
        path !== `${this.client.budgetPath}/stashes/${transaction.periodId}`
      ) {
        await increment(path, ["data", "completedTransactionCount"], direction);
      }
    }

    for (const t of accountTargets) {
      await increment(accountPath, ["data", t.id, "transactionCount"], direction);

      if (direction > 0) {
        await plan.set(accountPath, ["data", t.id, "updatedAt"], new Date());
      }
    }

    for (const t of categoryTargets) {
      await increment(categoryPath, ["data", "categories", t.id, "transactionCount"], direction);

      if (direction > 0) {
        await plan.set(categoryPath, ["data", "categories", t.id, "lastTransactionAt"], new Date());
      }
    }

    if (transaction.payee !== null) {
      await increment(
        `${this.client.budgetPath}/stashes/${this.client.stashId("PAYEES")}`,
        ["data", transaction.payee.id, "transactionCount"],
        direction
      );
    }

    for (const id of transaction.tagIds) {
      await increment(
        `${this.client.budgetPath}/stashes/${this.client.stashId("TAGS")}`,
        ["data", id, "transactionCount"],
        direction
      );
    }
  }
  async delete(id: string, options: CommitOptions = {}) {
    const context = await this.context();
    const doc = await this.transaction(id);
    const transaction = doc.data;
    requireIndependentTransaction(transaction, context.budget.data);
    supported(transaction);
    const plan = new MutationPlan(this.client);
    plan.extra.push({ currentDocument: { updateTime: doc.updateTime }, delete: doc.name });
    await this.apply(plan, transaction, -1, context);

    const summary =
      options.dryRun === true ? transactionSummary(plan, transaction, null) : undefined;

    return {
      ...(await this.client.commit(plan.writes(), options)),
      automaticAllocation: false,
      deleted: true,
      summary,
      transactionId: id,
    };
  }
  async update(id: string, input: TransactionPatch, options: CommitOptions = {}) {
    const changes = TransactionPatchSchema.parse(input);
    const context = await this.context();
    const plan = new MutationPlan(this.client);
    const { doc } = await plan.entry(`${this.client.budgetPath}/transactions/${requireId(id)}`);
    const transaction = TransactionSchema.parse(doc.data);

    if (transaction.id !== id || transaction.budgetId !== this.client.budgetId) {
      throw new Error("The transaction identity does not match its document path");
    }

    if (Boolean(transaction.splitId) || transaction.reconciled || !transaction.editable) {
      throw new Error("bebu changes only editable, unreconciled transactions without splits");
    }

    const metadata = new Set([
      "notes",
      "color",
      "sentiment",
      "latitude",
      "longitude",
      "reminderEnabled",
      "reminderName",
      "reminderDescription",
    ]);

    const financial = Object.keys(changes).some((key) => !metadata.has(key));

    if (financial) {
      requireIndependentTransaction(transaction, context.budget.data);
      supported(transaction);

      if (
        (transaction.type === "OUTFLOW" && transaction.amount >= 0) ||
        (transaction.type === "INFLOW" && transaction.amount <= 0)
      ) {
        throw new Error(
          "The stored transaction amount has an unexpected sign. Resolve it in the app"
        );
      }
    }

    const after = await editTransaction(this.client, transaction, changes, context);

    const ledgerFields = [
      "amount",
      "cleared",
      "dueAt",
      "timezone",
      "periodId",
      "yearMonth",
      "targetFrom",
      "targetTo",
      "payee",
      "tagIds",
    ];

    const ledgerChanged = ledgerFields.some(
      (key) => JSON.stringify(transaction[key]) !== JSON.stringify(after[key])
    );

    if (ledgerChanged) {
      await applyTransactionLedger(plan, transaction, -1, context);
      await applyTransactionLedger(plan, after, 1, context);
    }

    for (const [key, value] of Object.entries(after)) {
      if (JSON.stringify(value) !== JSON.stringify(transaction[key])) {
        let stored = value;

        if (key === "dueAt") {
          stored = new Date(after.dueAt);
        }

        if (key === "occurrenceChange" && after.occurrenceChange) {
          const occurrence = after.occurrenceChange;
          stored = {
            ...occurrence,
            dueAt: occurrence.dueAt === null ? null : new Date(occurrence.dueAt),
            seriesAnchorAt:
              occurrence.seriesAnchorAt === null ? null : new Date(occurrence.seriesAnchorAt),
          };
        }

        await plan.set(doc.name, [key], stored);
      }
    }

    await updateTransactionIndexes(plan, transaction, after, context);

    const summary =
      options.dryRun === true ? transactionSummary(plan, transaction, after) : undefined;

    return {
      ...(await this.client.commit(plan.writes(), options)),
      automaticAllocation: false,
      summary,
      transactionId: id,
    };
  }
  async list({
    limit = 20,
    pageToken,
    accountId,
  }: {
    limit?: number;
    pageToken?: string;
    accountId?: string;
  } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error("limit must be an integer from 1 to 1000");
    }

    if (accountId !== undefined && accountId !== "") {
      requireId(accountId);

      const result = await this.client.request(
        `${this.client.budgetPath}:runQuery`,
        QueryRowsSchema,
        {
          body: {
            structuredQuery: {
              from: [{ collectionId: "transactions" }],
              limit: 10_000,
              where: {
                compositeFilter: {
                  filters: ["targetFrom.id", "targetTo.id"].map((field) => ({
                    fieldFilter: {
                      field: { fieldPath: field },
                      op: "EQUAL",
                      value: { stringValue: accountId },
                    },
                  })),
                  op: "OR",
                },
              },
            },
          },
          method: "POST",
        }
      );

      const rows = result
        .flatMap((row) => (row.document ? [decodeTransaction(row.document.fields)] : []))
        .toSorted((a, b) => b.dueAt.localeCompare(a.dueAt));

      return {
        limit,
        matched: rows.length,
        scanLimitReached: rows.length === 10_000,
        source: "canonical-query",
        transactions: rows.slice(0, limit),
      };
    }

    const query = new URLSearchParams([
      ["pageSize", String(limit)],
      ["orderBy", "dueAt desc"],
    ]);

    if (pageToken !== undefined && pageToken !== "") {
      query.set("pageToken", pageToken);
    }

    const result = await this.client.request(
      `${this.client.budgetPath}/transactions?${query}`,
      CollectionSchema
    );

    return {
      nextPageToken: result.nextPageToken === "" ? null : (result.nextPageToken ?? null),
      source: "canonical-collection",
      transactions: result.documents.map((d) => decodeTransaction(d.fields)),
    };
  }
}
