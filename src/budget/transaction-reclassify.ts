/* oxlint-disable func-style, no-await-in-loop, max-classes-per-file, complexity -- A category reassignment validates and patches one captured state in order. */
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema, DocumentRoot, encode, fieldPath } from "../firestore/encoding.ts";
import type {
  CommitOptions,
  Data,
  FirestoreDocument,
  WireFields,
  WireValue,
  Write,
} from "../firestore/encoding.ts";
import { FirestoreTransaction } from "../firestore/transaction.ts";
import { ObjectIdSchema, TransactionFrequencySchema } from "./transaction-model.ts";
import { TransactionOperations } from "./transaction-operations.ts";

const InputSchema = z.strictObject({ categoryId: ObjectIdSchema, fromCategoryId: ObjectIdSchema });
const MoneySchema = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);

const TargetSchema = z.looseObject({
  id: ObjectIdSchema,
  linkedObjectId: z.string().nullable(),
  linkedObjectType: z.string().nullish(),
  type: z.string(),
});

const ExpenseSchema = z.looseObject({
  amount: MoneySchema,
  autoAllocateIfCapable: z.boolean().optional(),
  autoAllocateIfIncome: z.boolean().optional(),
  budgetId: ObjectIdSchema,
  cleared: z.boolean(),
  clonedToTransactionId: ObjectIdSchema.nullish(),
  completed: z.literal(true),
  createdBy: z.looseObject({ uid: ObjectIdSchema }).nullable(),
  dueAt: z.iso.datetime({ offset: true }),
  editable: z.boolean(),
  extraTarget: z.null().optional(),
  extras: z.record(
    z.string(),
    z.looseObject({ objectId: ObjectIdSchema, stashId: ObjectIdSchema, type: z.literal("DEBT") })
  ),
  files: z.array(z.never()),
  frequency: TransactionFrequencySchema,
  id: ObjectIdSchema,
  payee: TargetSchema.nullable(),
  periodId: ObjectIdSchema,
  reconciled: z.boolean(),
  reconciledAt: z.string().nullish(),
  siblingTransactionId: z.null(),
  splitId: ObjectIdSchema.nullable(),
  subType: z.literal("REFUND").nullable().optional(),
  tagIds: z.array(ObjectIdSchema),
  targetFrom: TargetSchema,
  targetTo: TargetSchema.extend({
    linkedObjectId: z.null(),
    linkedObjectType: z.null().optional(),
    type: z.literal("CATEGORY"),
  }),
  timezone: z.string().min(1),
  type: z.literal("OUTFLOW"),
  version: z.number().int().nullable().optional(),
  yearMonth: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u),
});

const SplitMemberSchema = ExpenseSchema.pick({
  amount: true,
  budgetId: true,
  completed: true,
  dueAt: true,
  frequency: true,
  id: true,
  periodId: true,
  splitId: true,
  targetFrom: true,
  type: true,
  yearMonth: true,
});

interface Entry {
  doc: FirestoreDocument;
  fields: WireFields;
  masks: string[];
  increments: Map<string, number>;
}

// Values copied between previews stay on the wire: timestamp precision, omissions and unknown
// fields never pass through a calculated transaction model or default-producing serializer.
class CategoryPatch {
  private readonly entries = new Map<string, Entry>();

  private entry(doc: FirestoreDocument) {
    let entry = this.entries.get(doc.name);

    if (!entry) {
      entry = { doc, fields: {}, increments: new Map(), masks: [] };
      this.entries.set(doc.name, entry);
    }

    return entry;
  }
  set(doc: FirestoreDocument, path: string[], value: WireValue | undefined) {
    const entry = this.entry(doc);
    entry.masks.push(fieldPath(...path));

    if (value === undefined) {
      return;
    }

    let { fields } = entry;

    for (const key of path.slice(0, -1)) {
      const existing = fields[key];

      if (existing === undefined) {
        fields[key] = { mapValue: { fields: {} } };
      }

      const map = fields[key];

      if (!map || !("mapValue" in map)) {
        throw new Error("Overlapping category patch");
      }

      ({ fields } = map.mapValue);
    }

    const key = path.at(-1);

    if (key === undefined) {
      throw new Error("Empty category patch path");
    }

    fields[key] = value;
  }
  increment(doc: FirestoreDocument, path: string[], amount: number) {
    const entry = this.entry(doc);
    const key = fieldPath(...path);
    const delta = (entry.increments.get(key) ?? 0) + amount;
    let before: unknown = doc.data;

    for (const part of path) {
      before = DataSchema.safeParse(before).data?.[part];
    }

    if (
      !Number.isSafeInteger(delta) ||
      (before !== undefined &&
        (!MoneySchema.safeParse(before).success || !Number.isSafeInteger(Number(before) + delta)))
    ) {
      throw new Error("Unsafe category amount or counter");
    }

    entry.increments.set(key, delta);
  }
  writes(): Write[] {
    return [...this.entries.values()].map(({ doc, fields, masks, increments }) => {
      const write: Write = {
        currentDocument: { updateTime: doc.updateTime },
        update: { fields, name: doc.name },
        updateMask: { fieldPaths: masks },
      };

      if (increments.size > 0) {
        write.updateTransforms = [...increments].map(([path, amount]) => ({
          fieldPath: path,
          increment: { integerValue: String(amount) },
        }));
      }

      return write;
    });
  }
}

function category(index: Data, id: string) {
  const record = DataSchema.parse(index[id]);

  if (
    record.id !== id ||
    record.type !== "DEFAULT" ||
    record.modifiable !== true ||
    record.archived === true ||
    record.deleted === true ||
    (record.linkedAccountIds !== undefined &&
      (!Array.isArray(record.linkedAccountIds) || record.linkedAccountIds.length !== 0))
  ) {
    throw new Error(
      "Category reassignment requires active modifiable ordinary categories without explicit account links"
    );
  }

  return {
    ...record,
    transactionCount: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .parse(record.transactionCount),
  };
}

function storedPreview(doc: FirestoreDocument, id: string): WireValue | undefined {
  if (doc.raw.fields.data === undefined) {
    return undefined;
  }

  const data = DataSchema.parse(doc.raw.fields.data).mapValue;
  const fields = DataSchema.parse(DataSchema.parse(data).fields ?? {});
  const bucket = fields.completedTransactions;

  if (bucket === undefined) {
    return undefined;
  }

  return z
    .record(z.string(), z.custom<WireValue>())
    .parse(DataSchema.parse(DataSchema.parse(bucket).mapValue).fields ?? {})[id];
}

function completeCategoryStash(doc: FirestoreDocument, id: string, categoryCount: number) {
  const data = DataSchema.parse(doc.data.data);
  const previews = z.record(z.string(), DataSchema).parse(data.completedTransactions ?? {});

  const count = z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .optional()
    .parse(data.completedTransactionCount);

  if (
    doc.data.id !== id ||
    doc.data.type !== "CATEGORY" ||
    doc.data.trimmed === true ||
    (count === undefined
      ? categoryCount !== 0 ||
        Object.keys(previews).length !== 0 ||
        data.historicalSpending !== undefined
      : count !== Object.keys(previews).length)
  ) {
    throw new Error(
      "Category reassignment requires complete category previews and explicit matching counts"
    );
  }

  return { count, data, previews };
}

function requireCategoryWriteScope(
  writes: Write[],
  scope: {
    canonical: string;
    period: string;
    index: string;
    source: string;
    destination: string;
    shared: Set<string>;
    id: string;
    from: string;
    to: string;
    month: string;
    amount: number;
  }
) {
  const expected = new Map<string, { fields: Set<string>; increments: Map<string, string> }>();
  expected.set(scope.canonical, { fields: new Set(["targetTo.id"]), increments: new Map() });
  expected.set(scope.period, {
    fields: new Set(),
    increments: new Map([
      [fieldPath("balances", scope.from, "spentAmount"), String(-scope.amount)],
      [fieldPath("balances", scope.to, "spentAmount"), String(scope.amount)],
    ]),
  });
  expected.set(scope.index, {
    fields: new Set(
      [scope.from, scope.to].map((id) => fieldPath("data", "categories", id, "lastTransactionAt"))
    ),
    increments: new Map([
      [fieldPath("data", "categories", scope.from, "transactionCount"), "-1"],
      [fieldPath("data", "categories", scope.to, "transactionCount"), "1"],
    ]),
  });

  for (const [name, direction] of [
    [scope.source, -1],
    [scope.destination, 1],
  ] as const) {
    expected.set(name, {
      fields: new Set([fieldPath("data", "completedTransactions", scope.id)]),
      increments: new Map([
        [fieldPath("data", "completedTransactionCount"), String(direction)],
        [fieldPath("data", "historicalSpending", scope.month), String(direction * scope.amount)],
      ]),
    });
  }

  const seen = new Set<string>();

  for (const write of writes) {
    const name = write.update?.name;

    if (
      name === undefined ||
      seen.has(name) ||
      write.delete !== undefined ||
      write.currentDocument === undefined ||
      !("updateTime" in write.currentDocument) ||
      write.updateMask === undefined
    ) {
      throw new Error("Category writes require unique version-protected patches");
    }

    seen.add(name);

    let allowed = expected.get(name);

    if (allowed === undefined && scope.shared.has(name)) {
      allowed = {
        fields: new Set(
          ["targetToId", "dueAt"].map((key) =>
            fieldPath("data", "completedTransactions", scope.id, key)
          )
        ),
        increments: new Map(),
      };
    }

    if (
      allowed === undefined ||
      write.updateMask.fieldPaths.some((path) => !allowed.fields.has(path)) ||
      new Set(write.updateMask.fieldPaths).size !== write.updateMask.fieldPaths.length
    ) {
      throw new Error(
        "Category reassignment cannot write account money, funding, reserves or unrelated fields"
      );
    }

    if (expected.has(name) && write.updateMask.fieldPaths.length !== allowed.fields.size) {
      throw new Error("Incomplete category patch mask");
    }

    if (
      !expected.has(name) &&
      !write.updateMask.fieldPaths.includes(
        fieldPath("data", "completedTransactions", scope.id, "targetToId")
      )
    ) {
      throw new Error("Shared previews must receive the new category");
    }

    const increments = write.updateTransforms ?? [];

    if (
      increments.length !== allowed.increments.size ||
      new Set(increments.map((transform) => transform.fieldPath)).size !== increments.length ||
      increments.some(
        (transform) =>
          !("increment" in transform) ||
          allowed.increments.get(transform.fieldPath) !== transform.increment.integerValue
      )
    ) {
      throw new Error(
        "Category spending and usage transfers must match the signed expense exactly"
      );
    }

    if (name === scope.canonical) {
      z.strictObject({
        targetTo: z.strictObject({
          mapValue: z.strictObject({
            fields: z.strictObject({ id: z.strictObject({ stringValue: z.literal(scope.to) }) }),
          }),
        }),
      }).parse(write.update?.fields);
    }
  }

  if ([...expected.keys()].some((name) => !seen.has(name))) {
    throw new Error("Incomplete category transfer");
  }
}

export class ExpenseCategoryService {
  private readonly operations: TransactionOperations;
  private readonly client: BeyondClient;

  constructor(client: BeyondClient, options: { home?: string } = {}) {
    this.client = client;
    this.operations = new TransactionOperations(client, options);
  }
  async reclassify(id: string, value: z.infer<typeof InputSchema>, options: CommitOptions = {}) {
    const input = InputSchema.parse(value);
    ObjectIdSchema.parse(id);

    return await this.operations.run(
      { action: "reclassify", input, transactionId: id },
      options,
      async (bound) => await this.apply(id, input, bound)
    );
  }
  private async apply(id: string, input: z.infer<typeof InputSchema>, options: CommitOptions) {
    if (input.categoryId === input.fromCategoryId) {
      throw new Error("Select a different category");
    }

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
        throw new Error("Category reassignment requires an ordinary zero-based budget");
      }

      const read = async (collection: string, key: string) =>
        await snapshot.document(`${this.client.budgetPath}/${collection}/${key}`);

      const canonical = await read("transactions", id);
      const expense = ExpenseSchema.parse(canonical.data);
      const refund = expense.subType === "REFUND";

      if (!expense.editable && !refund) {
        throw new Error(
          "Only completed refund category attribution can preserve a read-only financial lock; other locked records remain protected"
        );
      }

      if (refund ? expense.amount <= 0 : expense.amount >= 0) {
        throw new Error("An expense must be negative; a posted REFUND must be positive");
      }

      for (const [key, reference] of Object.entries(expense.extras)) {
        if (reference.objectId !== key) {
          throw new Error("Debt reference identity does not match its stored key");
        }

        const debt = await snapshot.document(
          `${this.client.budgetPath}/stashes/${reference.stashId}`
        );

        const loan = DataSchema.parse(DataSchema.parse(debt.data.data)[reference.objectId]);

        if (
          debt.data.id !== reference.stashId ||
          debt.data.type !== "DEBTS" ||
          loan.id !== reference.objectId
        ) {
          throw new Error("Debt reference does not match its saved stash and object");
        }

        MoneySchema.parse(loan.totalInflowAmount);
        MoneySchema.parse(loan.totalOutflowAmount);
        z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(loan.transactionCount);
      }

      const splitMembers: string[] = [];

      if (expense.splitId !== null) {
        const members = await snapshot.query("transactions", "splitId", expense.splitId, 21);

        if (
          members.length < 2 ||
          members.length > 20 ||
          !members.some(
            (member) => member.name === canonical.name && member.updateTime === canonical.updateTime
          )
        ) {
          throw new Error(
            "Category reassignment requires a complete split of 2–20 matching expenses"
          );
        }

        const parent = `${this.client.budgetPath}/transactions/${expense.splitId}`;

        const parentSnapshot = await snapshot.read([parent]);

        if (parentSnapshot.get(parent) !== null) {
          throw new Error("Split groups with a canonical parent require a separate workflow");
        }

        let total = 0;

        for (const member of members) {
          const sibling = SplitMemberSchema.parse(member.data);

          if (
            member.name !== `${this.client.budgetPath}/transactions/${sibling.id}` ||
            sibling.budgetId !== expense.budgetId ||
            sibling.splitId !== expense.splitId ||
            sibling.amount >= 0 ||
            sibling.frequency !== "ONE_OFF" ||
            expense.frequency !== "ONE_OFF" ||
            !isDeepStrictEqual(sibling.targetFrom, expense.targetFrom) ||
            sibling.periodId !== expense.periodId ||
            sibling.yearMonth !== expense.yearMonth ||
            new Date(sibling.dueAt).getTime() !== new Date(expense.dueAt).getTime()
          ) {
            throw new Error(
              "Split members must be completed editable negative expenses sharing the exact account, date and period"
            );
          }

          total += sibling.amount;

          if (!Number.isSafeInteger(total)) {
            throw new TypeError("Unsafe split total");
          }

          splitMembers.push(sibling.id);
        }
      }

      if (
        expense.id !== id ||
        expense.budgetId !== this.client.budgetId ||
        expense.targetTo.id !== input.fromCategoryId ||
        budget.data.availablePeriods[expense.yearMonth]?.id !== expense.periodId
      ) {
        throw new Error(
          "Category reassignment identity, source or period does not match the saved intent"
        );
      }

      const index = await read("stashes", this.client.stashId("GROUPS_AND_CATEGORIES"));
      const categories = DataSchema.parse(DataSchema.parse(index.data.data).categories);
      const oldCategory = category(categories, input.fromCategoryId);
      const nextCategory = category(categories, input.categoryId);
      const accounts = await read("stashes", this.client.stashId("ACCOUNTS"));
      const account = DataSchema.parse(DataSchema.parse(accounts.data.data)[expense.targetFrom.id]);
      const user = await snapshot.document(`${DocumentRoot}/users/${this.client.session.uid}`);
      const currency = z.string().min(1).parse(DataSchema.parse(user.data.config).currencyCode);
      const accountCurrency = z.string().parse(account.currencyCode);

      const calculationTimezone = z
        .string()
        .min(1)
        .parse(DataSchema.parse(user.data.config).timezone);

      const calendar = new Intl.DateTimeFormat("en-CA", {
        month: "2-digit",
        timeZone: calculationTimezone,
        year: "numeric",
      }).formatToParts(new Date(expense.dueAt));

      const historyMonth = `${calendar.find((part) => part.type === "year")?.value}-${calendar.find((part) => part.type === "month")?.value}`;

      if (historyMonth !== expense.yearMonth) {
        throw new Error(
          "Stored expense month disagrees with its date in the budget timezone; preserve it for separate review"
        );
      }

      if (accountCurrency !== "" && accountCurrency !== currency) {
        throw new Error("Foreign-currency category effects require a separate workflow");
      }

      for (const [accountId, value] of Object.entries(DataSchema.parse(accounts.data.data))) {
        const entry = DataSchema.parse(value);

        if (entry.id !== accountId || entry.linkedCategoryId === input.categoryId) {
          throw new Error(
            "Destination has a conflicting account identity or explicit reverse account link"
          );
        }
      }

      const saved = expense.targetFrom;
      const accountType = account.type === "SAVINGS" ? "GENERIC_ACCOUNT" : account.type;

      if (
        account.id !== saved.id ||
        !["GENERIC_ACCOUNT", "CREDIT_CARD"].includes(saved.type) ||
        accountType !== saved.type
      ) {
        throw new Error(
          "Category reassignment requires an identified ordinary savings or card account"
        );
      }

      const oldStash = await read("stashes", input.fromCategoryId);
      const nextStash = await read("stashes", input.categoryId);

      const old = completeCategoryStash(
        oldStash,
        input.fromCategoryId,
        oldCategory.transactionCount
      );

      const next = completeCategoryStash(
        nextStash,
        input.categoryId,
        nextCategory.transactionCount
      );

      const preview = old.previews[id];

      if (
        !preview ||
        next.previews[id] !== undefined ||
        preview.id !== id ||
        preview.amount !== expense.amount ||
        preview.targetFromId !== saved.id ||
        preview.targetToId !== input.fromCategoryId ||
        preview.completed !== true ||
        preview.cleared !== expense.cleared ||
        preview.type !== expense.type ||
        (preview.reconciled !== undefined && preview.reconciled !== expense.reconciled) ||
        (expense.splitId !== null && preview.splitId !== expense.splitId)
      ) {
        throw new Error("Stored category preview is absent, stale or ambiguous");
      }

      const rawPreview = storedPreview(oldStash, id);

      if (!rawPreview || !("mapValue" in rawPreview)) {
        throw new Error("Category preview must be a stored wire map");
      }

      const correctedPreviewFields = new Set<string>();
      const canonicalDate: WireValue = { timestampValue: expense.dueAt };
      const previewDate = new Date(z.string().parse(preview.dueAt)).getTime();

      if (!Number.isFinite(previewDate)) {
        throw new TypeError("Stored preview date is invalid");
      }

      const correctDate = previewDate !== new Date(expense.dueAt).getTime();

      if (correctDate) {
        correctedPreviewFields.add("dueAt");
      }

      const movedPreview: WireValue = {
        mapValue: {
          fields: { ...rawPreview.mapValue.fields, targetToId: encode(input.categoryId) },
        },
      };

      if (correctDate) {
        movedPreview.mapValue.fields.dueAt = canonicalDate;
      }

      const period = await read("periods", expense.periodId);

      if (
        (period.data.id !== undefined && period.data.id !== expense.periodId) ||
        (period.data.yearMonth !== undefined && period.data.yearMonth !== expense.yearMonth)
      ) {
        throw new Error("Saved period identity mismatch");
      }

      const oldSpending = DataSchema.parse(
        DataSchema.parse(period.data.balances)[input.fromCategoryId]
      ).spentAmount;

      const historical = DataSchema.parse(old.data.historicalSpending)[expense.yearMonth];

      if (
        !MoneySchema.safeParse(oldSpending).success ||
        !MoneySchema.safeParse(historical).success
      ) {
        throw new Error("Source category spending must be explicitly stored");
      }

      for (const count of [oldCategory.transactionCount, nextCategory.transactionCount]) {
        z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(count);
      }

      if (old.count === undefined || old.count < 1 || oldCategory.transactionCount < 1) {
        throw new Error("Source category count cannot be decremented");
      }

      const plan = new CategoryPatch();
      plan.set(canonical, ["targetTo", "id"], encode(input.categoryId));
      const amount = -expense.amount;
      plan.increment(period, ["balances", input.fromCategoryId, "spentAmount"], -amount);
      plan.increment(period, ["balances", input.categoryId, "spentAmount"], amount);

      for (const [doc, categoryId, direction] of [
        [oldStash, input.fromCategoryId, -1],
        [nextStash, input.categoryId, 1],
      ] as const) {
        plan.increment(doc, ["data", "historicalSpending", expense.yearMonth], direction * amount);
        plan.increment(doc, ["data", "completedTransactionCount"], direction);
        plan.set(
          doc,
          ["data", "completedTransactions", id],
          direction === 1 ? movedPreview : undefined
        );
        plan.increment(index, ["data", "categories", categoryId, "transactionCount"], direction);
        plan.set(
          index,
          ["data", "categories", categoryId, "lastTransactionAt"],
          encode(new Date())
        );
      }

      const indexes = [
        this.client.stashId("TRANSACTIONS"),
        expense.periodId,
        saved.id,
        expense.payee?.id,
        ...expense.tagIds,
      ];

      for (const key of new Set(indexes.filter((value): value is string => value !== undefined))) {
        const doc = await read("stashes", key);
        const existing = storedPreview(doc, id);

        if (existing === undefined) {
          continue;
        }

        const decoded = DataSchema.parse(DataSchema.parse(doc.data.data).completedTransactions)[id];
        const row = DataSchema.parse(decoded);

        if (
          row.id !== id ||
          row.targetToId !== input.fromCategoryId ||
          row.amount !== expense.amount
        ) {
          throw new Error("An existing transaction preview conflicts with its canonical record");
        }

        plan.set(
          doc,
          ["data", "completedTransactions", id, "targetToId"],
          encode(input.categoryId)
        );

        if (new Date(z.string().parse(row.dueAt)).getTime() !== new Date(expense.dueAt).getTime()) {
          plan.set(doc, ["data", "completedTransactions", id, "dueAt"], canonicalDate);
          correctedPreviewFields.add("dueAt");
        }
      }

      const writes = plan.writes();

      requireCategoryWriteScope(writes, {
        amount,
        canonical: canonical.name,
        destination: nextStash.name,
        from: input.fromCategoryId,
        id,
        index: index.name,
        month: historyMonth,
        period: period.name,
        shared: new Set(
          indexes.flatMap((key) =>
            key === undefined ? [] : [`${this.client.budgetPath}/stashes/${key}`]
          )
        ),
        source: oldStash.name,
        to: input.categoryId,
      });

      if (
        writes.some(
          (write) =>
            write.update?.name === accounts.name || write.update?.name === this.client.budgetPath
        )
      ) {
        throw new Error("Category reassignment cannot write account money or allocation history");
      }

      const summary = {
        accountBalanceChanges: [],
        amountMinor: Math.abs(expense.amount),
        calculationTimezone,
        canonicalFields: ["targetTo.id"],
        categoryId: input.categoryId,
        correctedPreviewFields: [...correctedPreviewFields],
        fromCategoryId: input.fromCategoryId,
        fundingChanges: [],
        historyMonth,
        laterSavedMonths: Object.keys(budget.data.availablePeriods)
          .filter((month) => month > expense.yearMonth)
          .toSorted(),
        preservesRawFields: true,
        propagationVerified: false,
        signedSpendingChange: amount,
        splitMembers,
        transactionId: id,
      };

      return {
        ...(await this.operations.commit(writes, options, snapshot)),
        executionSupported: true,
        summary,
      };
    } finally {
      await snapshot.rollback();
    }
  }
}
