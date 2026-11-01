/* oxlint-disable func-style, complexity, no-await-in-loop -- Native reallocation validation and its ordered snapshot mutations share this workflow. */
import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import {
  DataSchema,
  DocumentRoot,
  encodeFields,
  newId,
  patchDocument,
} from "../firestore/encoding.ts";
import type { CommitOptions, Data } from "../firestore/encoding.ts";
import { FirestoreTransaction } from "../firestore/transaction.ts";
import { transactionIndexPaths, transactionPreview } from "./transaction-index.ts";
import { ObjectIdSchema } from "./transaction-model.ts";
import type { Transaction } from "./transaction-model.ts";
import { TransactionOperations } from "./transaction-operations.ts";
import { MutationPlan } from "./transactions.ts";

const MoneySchema = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const CountSchema = MoneySchema.nonnegative();
const MonthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u);

export const ReallocationSchema = z.strictObject({
  amountMinor: MoneySchema.positive(),
  calculationTimezone: z.string().min(1),
  from: ObjectIdSchema,
  month: MonthSchema,
  to: ObjectIdSchema,
});

const BalanceSchema = z.looseObject({
  allocatedAmount: MoneySchema,
  carriedOverAmount: MoneySchema,
  otherAmount: MoneySchema,
  spentAmount: MoneySchema,
  upcomingAmount: MoneySchema,
});

const OrdinarySchema = z.looseObject({
  archived: z.literal(false).optional(),
  deleted: z.literal(false).optional(),
  id: ObjectIdSchema,
  modifiable: z.literal(true),
  type: z.literal("DEFAULT"),
});

function sum(values: number[]) {
  const result = values.reduce((total, value) => total + BigInt(value), 0n);

  return MoneySchema.parse(Number(result));
}

function available(balance: z.infer<typeof BalanceSchema>) {
  return sum([
    balance.allocatedAmount,
    balance.carriedOverAmount,
    balance.otherAmount,
    -balance.spentAmount,
  ]);
}

function monthAt(date: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      month: "2-digit",
      timeZone: timezone,
      year: "numeric",
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value])
  );

  return `${parts.year}-${parts.month}`;
}

// Native 62959 uses runtime local time on the selected month's last day outside the current month.
function dates(month: string, timezone: string, userTimezone: string, now: Date) {
  const runtime = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const requested = new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions()
    .timeZone;

  if (runtime !== requested) {
    throw new Error(
      "Reallocation calculation timezone must match the CLI runtime and the native device timezone"
    );
  }

  const createdAt = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const current = monthAt(createdAt, runtime);

  if (month < current) {
    throw new Error("Historical reallocation remains unsupported");
  }

  const dueAt = new Date(createdAt);

  if (month !== current) {
    const [year, number] = month.split("-").map(Number);
    dueAt.setFullYear(z.number().parse(year), z.number().parse(number), 0);
  }

  if (monthAt(dueAt, runtime) !== month || monthAt(dueAt, userTimezone) !== month) {
    throw new Error("Reallocation due-date month must agree in runtime and saved user timezones");
  }

  return { createdAt, dueAt };
}

function requireCategories(
  categories: Record<string, Data>,
  groups: Record<string, Data>,
  ids: string[],
  accounts: Record<string, Data>
) {
  for (const id of ids) {
    const raw = categories[id];
    const category = OrdinarySchema.parse(raw);

    if (category.id !== id || !z.tuple([]).safeParse(category.linkedAccountIds).success) {
      throw new Error(
        "Reallocation requires matching category identities and explicit empty account links"
      );
    }

    const groupId = ObjectIdSchema.parse(category.groupId);
    const group = OrdinarySchema.parse(groups[groupId]);

    if (group.id !== groupId || category.carryOverStrategy !== "ALL") {
      throw new Error("Reallocation requires ordinary groups and explicit ALL category carryover");
    }

    if (
      (category.parentCategoryId !== undefined &&
        category.parentCategoryId !== null &&
        category.parentCategoryId !== "") ||
      Object.values(categories).some((other) => other.parentCategoryId === id)
    ) {
      throw new Error("Reallocation supports flat categories without children only");
    }

    if (
      [
        "target",
        "aggregateAllocationForTarget",
        "accumulationStrategy",
        "computationStrategy",
        "amountComputationStrategy",
        "challengeId",
      ].some((field) => Object.hasOwn(category, field))
    ) {
      throw new Error("Reallocation excludes targets, coverage strategies, and challenges");
    }

    CountSchema.parse(category.transactionCount);
    MoneySchema.parse(sum([CountSchema.parse(category.transactionCount), 1]));
  }

  for (const [id, raw] of Object.entries(accounts)) {
    const account = z
      .object({ id: ObjectIdSchema, linkedCategoryId: z.string().nullable() })
      .parse(raw);

    if (
      account.id !== id ||
      (account.linkedCategoryId !== null && ids.includes(account.linkedCategoryId))
    ) {
      throw new Error("Reallocation account links conflict with the selected categories");
    }
  }
}

function requireIndex(raw: Data, id: string, type: string, transactionId: string) {
  const stash = z.object({ data: DataSchema, id: z.literal(id), type: z.literal(type) }).parse(raw);

  const data = z
    .looseObject({
      completedTransactionCount: CountSchema,
      completedTransactions: z.record(z.string(), DataSchema),
      trimmed: z.literal(false),
    })
    .parse(stash.data);

  const previews = Object.entries(data.completedTransactions);

  // Native admission can evict at 450 entries/700KB. This bounded subset never approaches either limit.
  if (
    previews.length !== data.completedTransactionCount ||
    previews.length >= 20 ||
    Buffer.byteLength(JSON.stringify(raw)) > 25_000
  ) {
    throw new Error("Reallocation requires small complete untrimmed transaction indexes");
  }

  for (const [key, preview] of previews) {
    if (preview.id !== key || preview.completed !== true) {
      throw new Error("Reallocation index identities or completion counts disagree");
    }
  }

  if (Object.hasOwn(data.completedTransactions, transactionId)) {
    throw new Error("Reallocation transaction identity already exists in an index");
  }

  return data;
}

function target(categoryId: string) {
  return { id: categoryId, linkedObjectId: null, linkedObjectType: null, type: "CATEGORY" };
}

function indexType(stashId: string, periodId: string, globalId: string) {
  if (stashId === periodId) {
    return "PERIOD";
  }

  if (stashId === globalId) {
    return "TRANSACTIONS";
  }

  return "CATEGORY";
}

function createTransaction(
  client: BeyondClient,
  input: z.infer<typeof ReallocationSchema>,
  id: string,
  periodId: string,
  user: Data,
  now: Date
): Transaction {
  const config = z.object({ timezone: z.string().min(1) }).parse(user.config);
  const { createdAt, dueAt } = dates(input.month, input.calculationTimezone, config.timezone, now);

  const creator = z
    .object({ displayName: z.string(), photoUrl: z.string().default("") })
    .parse(user);

  return {
    amount: -input.amountMinor,
    autoAllocateIfCapable: true,
    autoAllocateIfIncome: true,
    budgetId: client.budgetId,
    cleared: true,
    clonedToTransactionId: null,
    color: "NONE",
    completed: true,
    createdAt: createdAt.toISOString(),
    createdBy: { ...creator, email: null, uid: client.session.uid },
    dueAt: dueAt.toISOString(),
    editable: false,
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
    notes: "",
    offsetAdjustment: 0,
    payee: null,
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
    tagIds: [],
    targetFrom: target(input.from),
    targetTo: target(input.to),
    timezone: config.timezone,
    type: "REALLOCATE_MONEY",
    version: 1,
    yearMonth: input.month,
  };
}

export class ReallocationService {
  private readonly client: BeyondClient;
  private readonly operations: TransactionOperations;
  constructor(client: BeyondClient, options: { home?: string } = {}) {
    this.client = client;
    this.operations = new TransactionOperations(client, options);
  }
  async reallocate(value: z.input<typeof ReallocationSchema>, options: CommitOptions = {}) {
    const input = ReallocationSchema.parse(value);

    if (input.from === input.to) {
      throw new Error("Reallocation source and destination must differ");
    }

    return await this.operations.run(
      { action: "reallocate", input },
      options,
      async (bound) => await this.execute(input, bound)
    );
  }
  private async execute(input: z.infer<typeof ReallocationSchema>, options: CommitOptions) {
    const { client } = this;

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
        throw new Error("Reallocation requires an identified ordinary zero-based budget");
      }

      const months = Object.keys(budget.data.availablePeriods)
        .map((month) => MonthSchema.parse(month))
        .toSorted();

      if (months.at(-1) !== input.month) {
        throw new Error(
          "Reallocation requires the latest saved month; downstream carryover is unsupported"
        );
      }

      const periodId = ObjectIdSchema.parse(budget.data.availablePeriods[input.month]?.id);

      if (
        Object.values(budget.data.availablePeriods).filter(({ id }) => id === periodId).length !== 1
      ) {
        throw new Error("Reallocation period identity is ambiguous");
      }

      const id = newId();
      const history = z.record(z.string(), DataSchema).parse(budget.data.allocationHistory);

      if (Object.hasOwn(history, id)) {
        throw new Error("Reallocation history identity already exists");
      }

      const canonicalPath = `${client.budgetPath}/transactions/${id}`;

      const [index, accounts, user, period, absence] = await Promise.all([
        snapshot.document(
          `${client.budgetPath}/stashes/${client.stashId("GROUPS_AND_CATEGORIES")}`
        ),
        snapshot.document(`${client.budgetPath}/stashes/${client.stashId("ACCOUNTS")}`),
        snapshot.document(`${DocumentRoot}/users/${client.session.uid}`),
        snapshot.document(`${client.budgetPath}/periods/${periodId}`),
        snapshot.read([canonicalPath]),
      ]);

      if (absence.get(canonicalPath) !== null) {
        throw new Error("Reallocation canonical identity already exists");
      }

      const structure = z
        .object({
          data: z.object({
            categories: z.record(z.string(), DataSchema),
            groups: z.record(z.string(), DataSchema),
          }),
        })
        .parse(index.data);

      requireCategories(
        structure.data.categories,
        structure.data.groups,
        [input.from, input.to],
        z.record(z.string(), DataSchema).parse(accounts.data.data)
      );

      if (period.data.id !== periodId || period.data.yearMonth !== input.month) {
        throw new Error("Reallocation saved period disagrees with selected month");
      }

      const balances = z.record(z.string(), DataSchema).parse(period.data.balances);
      const source = BalanceSchema.parse(balances[input.from]);
      const destination = BalanceSchema.parse(balances[input.to]);
      const sourceAvailable = available(source);
      const destinationAvailable = available(destination);

      if (sourceAvailable < input.amountMinor) {
        throw new Error("Reallocation exceeds explicitly known source availability");
      }

      const sourceAfter = sum([source.allocatedAmount, -input.amountMinor]);
      const destinationAfter = sum([destination.allocatedAmount, input.amountMinor]);
      const sourceAvailableAfter = sum([sourceAvailable, -input.amountMinor]);
      const destinationAvailableAfter = sum([destinationAvailable, input.amountMinor]);
      const now = new Date();
      const transaction = createTransaction(client, input, id, periodId, user.data, now);
      const plan = new MutationPlan(client, snapshot);
      const paths = transactionIndexPaths(client, transaction);

      if (paths.length !== 4 || paths.includes(index.name) || paths.includes(accounts.name)) {
        throw new Error("Reallocation requires four distinct transaction index identities");
      }

      const preview = transactionPreview(transaction);
      // Native completed reallocation projection omits these ordinary scheduling-only fields (49253).
      delete preview.anchorDay;
      delete preview.seriesAmount;
      delete preview.seriesAnchorAt;

      for (const path of paths) {
        const entry = await plan.entry(path);
        const stashId = path.slice(path.lastIndexOf("/") + 1);

        const type = indexType(stashId, periodId, client.stashId("TRANSACTIONS"));

        const data = requireIndex(entry.doc.data, stashId, type, id);

        if (stashId === input.from || stashId === input.to) {
          const historical = z.record(z.string(), MoneySchema).parse(data.historicalAllocations);

          const expected =
            stashId === input.from ? source.allocatedAmount : destination.allocatedAmount;

          if (historical[input.month] !== expected) {
            throw new Error(
              "Reallocation requires explicit category allocation history matching the saved period"
            );
          }

          await plan.increment(
            path,
            ["data", "historicalAllocations", input.month],
            stashId === input.from ? -input.amountMinor : input.amountMinor
          );
        }

        await plan.increment(path, ["data", "completedTransactionCount"], 1);
        await plan.set(path, ["data", "completedTransactions", id], preview);
      }

      await plan.increment(
        period.name,
        ["balances", input.from, "allocatedAmount"],
        -input.amountMinor
      );
      await plan.increment(
        period.name,
        ["balances", input.to, "allocatedAmount"],
        input.amountMinor
      );

      for (const categoryId of [input.from, input.to]) {
        await plan.increment(index.name, ["data", "categories", categoryId, "transactionCount"], 1);
      }

      plan.extra.push({
        currentDocument: { exists: false },
        update: {
          fields: encodeFields({
            ...transaction,
            createdAt: new Date(transaction.createdAt),
            dueAt: new Date(transaction.dueAt),
          }),
          name: canonicalPath,
        },
      });

      // Native 50296 uses client Timestamp.now() for history, separately from the transaction's whole-second timestamps.
      const historyEntry = {
        accountId: "",
        afterAmount: input.amountMinor,
        beforeAmount: source.allocatedAmount,
        categoryId: input.from,
        createdAt: now,
        id,
        linkedCategoryId: input.to,
        overallocationAmount: 0,
        overallocationStatus: "NONE",
        periodId,
        source: "MONEY_REALLOCATION",
        undoneAt: null,
      };

      plan.extra.push(
        patchDocument(budget, [
          { path: ["allocationHistory", id], value: historyEntry },
          { path: ["changeSource"], value: "USER" },
        ])
      );
      const result = await this.operations.commit(plan.writes(), options, snapshot);

      return {
        ...result,
        executionSupported: true,
        summary: {
          amountMinor: input.amountMinor,
          automaticAllocation: false,
          destination: {
            allocatedAfter: destinationAfter,
            allocatedBefore: destination.allocatedAmount,
            availableAfter: destinationAvailableAfter,
            availableBefore: destinationAvailable,
            categoryId: input.to,
          },
          downstreamPropagation: "not-supported",
          history: historyEntry,
          month: input.month,
          periodId,
          persistence: "atomic-transaction-and-history",
          recovery: "transactions operation/recover; observe-only",
          source: {
            allocatedAfter: sourceAfter,
            allocatedBefore: source.allocatedAmount,
            availableAfter: sourceAvailableAfter,
            availableBefore: sourceAvailable,
            categoryId: input.from,
          },
          transaction,
        },
        transactionId: id,
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
