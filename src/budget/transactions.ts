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
import type { Account } from "./accounts.ts";
import { requireIndependentTransaction } from "./allocation-effects.ts";
import { LabelsSchema } from "./labels.ts";
import { CategoriesSchema, PeriodSchema, categoryAvailable } from "./model.ts";
import type { Category } from "./model.ts";
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

type TransactionContext = Awaited<ReturnType<TransactionService["context"]>>;

const requireId = (id: string): string => ObjectIdSchema.parse(id);

const requireTarget = (target: Target | null): Target => {
  if (!target) {
    throw new Error("Transaction is missing a required target");
  }

  return target;
};

// Each consumer validates nested Firestore paths for numeric values or existence.
const get = (object: Data, path: string[]): unknown => {
  let value: unknown = object;

  for (const key of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
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
    const numeric = z.number().int().safe().safeParse(existing);
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

    if (!entry) {
      return;
    }

    const before = z
      .number()
      .int()
      .safe()
      .parse(get(entry.doc.data, path) ?? 0);

    const delta = entry.increments.get(fieldPath(...path)) ?? 0;
    const after = before + delta;

    if (!Number.isSafeInteger(after)) {
      throw new TypeError("The resulting amount must be a safe integer");
    }

    return { after, before, delta };
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

const preview = (transaction: Transaction): Data => {
  const keys = [
    "id",
    "amount",
    "autoAllocateIfIncome",
    "cleared",
    "clonedToTransactionId",
    "color",
    "completed",
    "externalId",
    "frequency",
    "latitude",
    "longitude",
    "nonWorkingDayPolicy",
    "notes",
    "offsetAdjustment",
    "reconciled",
    "reconciledAt",
    "reminderEnabled",
    "repeatCount",
    "sentiment",
    "sequenceCount",
    "splitId",
    "subType",
    "tagIds",
    "type",
    "integrityCount",
  ];

  const transactionPreview = Object.fromEntries(keys.map((k) => [k, transaction[k] ?? null]));
  transactionPreview.dueAt = new Date(transaction.dueAt);
  transactionPreview.createdByUserId = transaction.createdBy.uid;
  transactionPreview.targetFromId = transaction.targetFrom?.id ?? null;
  transactionPreview.targetToId = transaction.targetTo?.id ?? null;
  transactionPreview.payeeId = transaction.payee?.id ?? null;
  transactionPreview.extraTargetId = transaction.extraTarget?.id ?? null;
  transactionPreview.hasFiles = !!transaction.files?.length;
  transactionPreview.hasAutoAllocated = !!transaction.extras?.autoAllocated;

  if (transaction.reconciledAt) {
    transactionPreview.reconciledAt = new Date(transaction.reconciledAt);
  }

  if (!transaction.completed) {
    transactionPreview.editable = transaction.editable;
  }

  return transactionPreview;
};

const supported = (transaction: Transaction): void => {
  if (!["OUTFLOW", "INFLOW"].includes(transaction.type)) {
    throw new Error(
      `bebu changes only expenses and income. The ${transaction.type} type requires a separate ledger flow`
    );
  }

  if (
    transaction.frequency !== "ONE_OFF" ||
    transaction.splitId ||
    transaction.siblingTransactionId ||
    transaction.clonedToTransactionId ||
    transaction.subType ||
    transaction.extraTarget ||
    Object.keys(transaction.extras || {}).length ||
    transaction.files?.length
  ) {
    throw new Error(
      "The transaction has links, repeats, splits, files, or extra behavior that bebu does not support"
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

const makeTarget = (
  id: string,
  kind: "account" | "category",
  accounts: Record<string, Account>,
  categories: Record<string, Category>
): Target => {
  requireId(id);

  if (kind === "category") {
    const category = categories[id];

    if (!category || category.archived || category.deleted) {
      throw new Error("Category not available");
    }

    if (category.type !== "DEFAULT") {
      throw new Error(
        "Card payments require a transfer. Special categories cannot receive expenses"
      );
    }

    return { id, linkedObjectId: null, linkedObjectType: null, type: "CATEGORY" };
  }

  const account = accounts[id];

  if (!account || account.archived || account.hidden || account.locked) {
    throw new Error("Account is archived, hidden, locked, or missing");
  }

  if (
    !["CREDIT_CARD", "SAVINGS", "CHECKING", "CASH", "CASH_ON_HAND", "INVESTMENT"].includes(
      account.type
    )
  ) {
    throw new Error(`Unsupported account type ${account.type}`);
  }

  const linked = Object.values(categories).filter((category) =>
    category.linkedAccountIds?.includes(id)
  );

  if (linked.length > 1) {
    throw new Error("Account has multiple linked categories");
  }

  if (account.linkedCategoryId !== undefined) {
    const accountLink = z.string().nullable().parse(account.linkedCategoryId) || null;

    if (accountLink !== (linked[0]?.id ?? null)) {
      throw new Error(
        "Account and category links disagree. Resolve the links in the app before this transaction"
      );
    }
  }

  return {
    id,
    linkedObjectId: linked[0]?.id ?? null,
    linkedObjectType: linked.length ? "CATEGORY" : null,
    type: account.type === "CREDIT_CARD" ? "CREDIT_CARD" : "GENERIC_ACCOUNT",
  };
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
      input.timezone ||
      context.user.config?.timezone ||
      Intl.DateTimeFormat().resolvedOptions().timeZone;

    const dueAt = new Date(input.dueAt || Date.now());

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

    if (!periodId) {
      throw new Error(
        `Budget period ${yearMonth} does not exist. Create or select that period in the app`
      );
    }

    const type = input.type || "OUTFLOW";
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

    const id = requireId(input.id || options.requestId || newId());
    let payee: Target | null = null;

    if (input.payeeId) {
      const stashResult = await this.client.stash("PAYEES", LabelsSchema);
      const payees = stashResult.data.data;
      const p = payees[input.payeeId];

      if (!p || p.archived) {
        throw new Error("Payee not found");
      }

      payee = { id: p.id, linkedObjectId: null, linkedObjectType: null, type: "PAYEE" };
    }

    const tagIds = input.tagIds || [];

    if (!Array.isArray(tagIds) || new Set(tagIds).size !== tagIds.length) {
      throw new Error("tagIds must be a list of unique IDs");
    }

    if (tagIds.length) {
      const stashResult1 = await this.client.stash("TAGS", LabelsSchema);
      const tags = stashResult1.data.data;

      for (const tagId of tagIds) {
        if (!tags[tagId] || tags[tagId].archived) {
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

    if (account?.currencyCode && account.currencyCode !== context.user.config?.currencyCode) {
      throw new Error("bebu does not support changes to foreign-currency transactions");
    }

    const transaction: Transaction = {
      amount: type === "INFLOW" ? input.amountMinor : -input.amountMinor,
      autoAllocateIfCapable: false,
      autoAllocateIfIncome: false,
      budgetId: this.client.budgetId,
      cleared: input.cleared ?? true,
      clonedToTransactionId: null,
      color: input.color || "NONE",
      completed,
      createdAt: new Date().toISOString(),
      createdBy: {
        displayName: context.user.displayName || "",
        email: null,
        photoUrl: context.user.photoUrl || "",
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
      notes: input.notes || "",
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
    const summary = options.dryRun ? transactionSummary(plan, null, transaction) : undefined;
    const result = await this.client.commit(plan.writes(), options);

    return { ...result, automaticAllocation: false, summary, transactionId: id };
  }
  indexPaths(transaction: Transaction): string[] {
    const ids = [
      this.client.stashId("TRANSACTIONS"),
      transaction.periodId,
      transaction.targetFrom?.id,
      transaction.targetTo?.id,
      transaction.payee?.id,
      ...(transaction.tagIds || []),
    ].filter((candidate): candidate is string => typeof candidate === "string");

    return [...new Set(ids)].map((id) => `${this.client.budgetPath}/stashes/${id}`);
  }
  async apply(
    plan: MutationPlan,
    transaction: Transaction,
    direction: 1 | -1,
    context: TransactionContext
  ) {
    supported(transaction);

    if (!transaction.periodId) {
      throw new Error("The transaction has no budget period. Select its month in the app");
    }

    const periodPath = `${this.client.budgetPath}/periods/${transaction.periodId}`;
    const entryResult = await plan.entry(periodPath);
    const period = PeriodSchema.parse(entryResult.doc.data);
    const amount = Math.abs(transaction.amount);
    const delta = direction * amount;
    const accountPath = context.accounts.name;
    const categoryPath = context.categories.name;
    const increment = (name: string, path: string[], n: number) => plan.increment(name, path, n);

    const periodInc = (id: string, key: string, n: number) =>
      increment(periodPath, ["balances", id, key], n);

    const balance = (account: Target, n: number) =>
      increment(accountPath, ["data", account.id, "balanceAmount"], n);

    const history = (id: string, key: string, n: number) =>
      increment(`${this.client.budgetPath}/stashes/${id}`, ["data", key, transaction.yearMonth], n);

    const accountEffects = async (account: Target, n: number) => {
      await balance(account, n);

      if (!transaction.cleared) {
        await increment(accountPath, ["data", account.id, "unclearedBalanceAmount"], n);
      }

      await history(account.id, "historicalBalances", n);
    };

    const accountTargets = [transaction.targetFrom, transaction.targetTo].filter(
      (t): t is Target => t !== null && t.type !== "CATEGORY"
    );

    const categoryTargets = [transaction.targetFrom, transaction.targetTo].filter(
      (t): t is Target => t !== null && t.type === "CATEGORY"
    );

    for (const t of accountTargets) {
      const a = context.accountMap[t.id];

      if (a?.currencyCode && a.currencyCode !== context.user.config?.currencyCode) {
        throw new Error("bebu does not support changes to foreign-currency ledgers");
      }
    }

    if (transaction.type === "OUTFLOW") {
      const from = requireTarget(transaction.targetFrom);
      const to = requireTarget(transaction.targetTo);

      if (transaction.completed) {
        if (from.type === "CREDIT_CARD") {
          if (!from.linkedObjectId) {
            throw new Error("Credit card has no linked payment category");
          }

          if (direction > 0 && categoryAvailable(period.balances?.[to.id]) < amount) {
            throw new Error(
              "Fund the expense category first. bebu does not allocate funds automatically"
            );
          }

          if (direction < 0 && categoryAvailable(period.balances?.[to.id]) < 0) {
            throw new Error(
              "bebu cannot reverse unfunded card spending. The reversal requires changes to fund allocation"
            );
          }

          await periodInc(from.linkedObjectId, "otherAmount", delta);
        }

        await accountEffects(from, -delta);
        await periodInc(to.id, "spentAmount", delta);
        await history(to.id, "historicalSpending", delta);
      } else {
        await periodInc(to.id, "upcomingAmount", delta);
      }
    } else if (transaction.type === "INFLOW" && transaction.completed) {
      await accountEffects(requireTarget(transaction.targetTo), delta);

      // Native 51745 adds cleared zero-based income to allocation resources, independently of category allocation.
      if (transaction.cleared && context.budget.data.type === "ZERO_BASED") {
        await increment(periodPath, ["allocationAmount"], delta);
      }
    }

    if (transaction.completed) {
      for (const id of [transaction.payee?.id, ...transaction.tagIds].filter(
        (candidate): candidate is string => typeof candidate === "string"
      )) {
        await history(id, "historicalBalances", direction * transaction.amount);

        if (transaction.type === "OUTFLOW") {
          await history(id, "historicalSpending", -direction * transaction.amount);
        }
      }
    }

    const bucket = transaction.completed ? "completedTransactions" : "upcomingTransactions";
    const paths = await this.indexPaths(transaction);

    for (const path of paths) {
      const entry = await plan.entry(path);

      if (direction < 0 && !get(entry.doc.data, ["data", bucket, transaction.id])) {
        continue;
      }

      await plan.set(
        path,
        ["data", bucket, transaction.id],
        direction > 0 ? preview(transaction) : undefined
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

    if (transaction.payee?.id) {
      await increment(
        `${this.client.budgetPath}/stashes/${this.client.stashId("PAYEES")}`,
        ["data", transaction.payee.id, "transactionCount"],
        direction
      );
    }

    for (const id of transaction.tagIds || []) {
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

    const summary = options.dryRun ? transactionSummary(plan, transaction, null) : undefined;

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

    if (changes.color !== undefined) {
      const stashResult2 = await this.client.stash("GROUPS_AND_CATEGORIES", CategoriesSchema);
      const colors = stashResult2.data.data.categories;

      if (
        changes.color !== "NONE" &&
        !Object.values(colors).some((context) => context.color === changes.color)
      ) {
        throw new Error("Choose a color value from an existing category");
      }
    }

    const budget = await this.client.discover();
    const doc = await this.transaction(id);
    const transaction = doc.data;

    if (changes.cleared !== undefined && changes.cleared !== transaction.cleared) {
      requireIndependentTransaction(transaction, budget.data);
      supported(transaction);
    }

    if (transaction.splitId || transaction.frequency !== "ONE_OFF" || transaction.reconciled) {
      throw new Error("bebu changes only unreconciled, one-off transactions");
    }

    const plan = new MutationPlan(this.client);

    for (const [key, value] of Object.entries(changes)) {
      await plan.set(doc.name, [key], value);
    }

    const bucket = transaction.completed ? "completedTransactions" : "upcomingTransactions";

    for (const path of await this.indexPaths(transaction)) {
      const e = await plan.entry(path);

      if (!get(e.doc.data, ["data", bucket, id])) {
        continue;
      }

      for (const [key, value] of Object.entries(changes)) {
        await plan.set(path, ["data", bucket, id, key], value);
      }
    }

    if (
      transaction.completed &&
      changes.cleared !== undefined &&
      changes.cleared !== transaction.cleared
    ) {
      const direction = changes.cleared ? -1 : 1;
      const from = transaction.targetFrom;
      const to = transaction.targetTo;
      const accountPath = `${this.client.budgetPath}/stashes/${this.client.stashId("ACCOUNTS")}`;

      if (transaction.type === "INFLOW" && budget.data.type === "ZERO_BASED") {
        if (!transaction.periodId) {
          throw new Error(
            "The income has no budget period. Resolve it in the app before changing cleared status"
          );
        }

        await plan.increment(
          `${this.client.budgetPath}/periods/${transaction.periodId}`,
          ["allocationAmount"],
          -direction * transaction.amount
        );
      }

      if (from && from.type !== "CATEGORY") {
        await plan.increment(
          accountPath,
          ["data", from.id, "unclearedBalanceAmount"],
          direction * transaction.amount
        );
      }

      if (to && to.type !== "CATEGORY") {
        await plan.increment(
          accountPath,
          ["data", to.id, "unclearedBalanceAmount"],
          direction * (transaction.type === "TRANSFER" ? -transaction.amount : transaction.amount)
        );
      }
    }

    const summary = options.dryRun
      ? transactionSummary(plan, transaction, { ...transaction, ...changes })
      : undefined;

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

    if (accountId) {
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

    if (pageToken) {
      query.set("pageToken", pageToken);
    }

    const result = await this.client.request(
      `${this.client.budgetPath}/transactions?${query}`,
      CollectionSchema
    );

    return {
      nextPageToken: result.nextPageToken || null,
      source: "canonical-collection",
      transactions: (result.documents || []).map((d) => decodeTransaction(d.fields)),
    };
  }
}
