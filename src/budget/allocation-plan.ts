/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- These schema and canonical JSON boundaries validate untrusted Firestore or saved-plan values. */
/* oxlint-disable func-style -- Named domain functions follow the repository TypeScript conventions. */
import { createHash } from "node:crypto";

import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema, DocumentRoot, newId, patchDocument } from "../firestore/encoding.ts";
import type { FirestoreDocument, Write } from "../firestore/encoding.ts";
import { FirestoreTransaction } from "../firestore/transaction.ts";
import {
  AllocationIntentSchema,
  ManualPeriodSchema,
  calculateManualAllocation,
} from "./manual-allocation.ts";
import type { AllocationIntent } from "./manual-allocation.ts";
import { ObjectIdSchema } from "./transaction-model.ts";

const MonthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u);
const IdentitySchema = z.string().regex(/^[A-Za-z0-9]{20}$/u);
const SourceSchema = z.strictObject({ document: z.string(), updateTime: z.string() });

const PlanBodySchema = z.strictObject({
  actor: ObjectIdSchema,
  budgetId: ObjectIdSchema,
  categoryId: ObjectIdSchema,
  createdAt: z.iso.datetime(),
  database: z.literal("(default)"),
  historyId: IdentitySchema,
  intent: AllocationIntentSchema,
  markerId: IdentitySchema,
  month: MonthSchema,
  projectId: z.literal("beyond-budget"),
  sources: z.array(SourceSchema),
  summary: DataSchema,
  version: z.literal(1),
  writes: z.array(DataSchema),
});

export const AllocationPlanSchema = PlanBodySchema.extend({
  hash: z.string().regex(/^[a-f0-9]{64}$/u),
});

export type AllocationPlan = z.infer<typeof AllocationPlanSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }

  const object = DataSchema.safeParse(value);

  if (object.success) {
    return Object.fromEntries(
      Object.entries(object.data)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)])
    );
  }

  return value;
}

export function allocationHash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function validateAllocationPlan(input: unknown) {
  const plan = AllocationPlanSchema.parse(input);
  const { hash, ...body } = plan;

  if (allocationHash(body) !== hash || plan.historyId === plan.markerId) {
    throw new Error("Invalid allocation plan hash or operation identities");
  }

  return plan;
}

function requireDocument(documents: Map<string, FirestoreDocument | null>, path: string) {
  const document = documents.get(path);

  if (!document) {
    throw new Error(`Required allocation document is missing: ${path}`);
  }

  return document;
}

const RootSchema = z.object({
  allocationHistory: DataSchema.default({}),
  availablePeriods: z.record(MonthSchema, z.object({ id: ObjectIdSchema })),
  currentChallenge: z.null().optional(),
  id: ObjectIdSchema,
  stashIdentifiers: z.object({ ACCOUNTS: ObjectIdSchema, GROUPS_AND_CATEGORIES: ObjectIdSchema }),
  type: z.literal("ZERO_BASED"),
});

export async function readManualSnapshot(
  client: BeyondClient,
  transaction: FirestoreTransaction,
  month: string,
  categoryId: string,
  now: Date
) {
  MonthSchema.parse(month);
  ObjectIdSchema.parse(categoryId);
  const root = requireDocument(await transaction.read([client.budgetPath]), client.budgetPath);
  const budget = RootSchema.parse(root.data);

  if (budget.id !== client.budgetId) {
    throw new Error("Allocation budget identity mismatch");
  }

  const periodId = ObjectIdSchema.parse(budget.availablePeriods[month]?.id);

  const later = Object.keys(budget.availablePeriods)
    .filter((key) => key > month)
    .toSorted();

  const next = new Date(`${month}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);

  if (later.length > 1 || (later[0] !== undefined && later[0] !== next.toISOString().slice(0, 7))) {
    throw new Error("Manual allocation supports at most the existing next month");
  }

  const periodPath = `${client.budgetPath}/periods/${periodId}`;
  const categoryPath = `${client.budgetPath}/stashes/${categoryId}`;
  const indexPath = `${client.budgetPath}/stashes/${budget.stashIdentifiers.GROUPS_AND_CATEGORIES}`;
  const accountsPath = `${client.budgetPath}/stashes/${budget.stashIdentifiers.ACCOUNTS}`;
  const userPath = `${DocumentRoot}/users/${client.session.uid}`;

  const laterPaths = later.map(
    (key) => `${client.budgetPath}/periods/${budget.availablePeriods[key]?.id}`
  );

  const documents = await transaction.read([
    periodPath,
    categoryPath,
    indexPath,
    accountsPath,
    userPath,
    ...laterPaths,
  ]);

  const period = requireDocument(documents, periodPath);
  const category = requireDocument(documents, categoryPath);
  const index = requireDocument(documents, indexPath);
  const accounts = requireDocument(documents, accountsPath);
  const user = requireDocument(documents, userPath);

  const config = z
    .object({ currencyCode: z.string().min(1), timezone: z.string().min(1) })
    .parse(user.data.config);

  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    timeZone: config.timezone,
    year: "numeric",
  }).formatToParts(now);

  const current = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  if (month !== `${current.year}-${current.month}`) {
    throw new Error("Manual allocation requires the current month in the saved user timezone");
  }

  const selected = ManualPeriodSchema.parse(period.data);

  if (selected.id !== periodId || selected.yearMonth !== month) {
    throw new Error("Allocation period identity mismatch");
  }

  const historical = z
    .object({
      data: z.object({
        historicalAllocations: z.record(z.string(), z.number().int()).default({}),
      }),
      id: z.literal(categoryId),
      type: z.literal("CATEGORY"),
    })
    .parse(category.data);

  if (
    (historical.data.historicalAllocations[month] ?? 0) !==
    (selected.balances[categoryId]?.allocatedAmount ?? 0)
  ) {
    throw new Error("Allocation period and category history disagree");
  }

  const future = laterPaths.map((path, offset) => {
    const document = requireDocument(documents, path);
    const result = ManualPeriodSchema.parse(document.data);

    if (
      result.id !== budget.availablePeriods[later[offset] ?? ""]?.id ||
      result.yearMonth !== later[offset]
    ) {
      throw new Error("Future allocation period identity mismatch");
    }

    if (
      result.allocationAmount !== 0 ||
      Object.values(result.balances).some(
        (balance) => balance.spentAmount !== 0 || balance.otherAmount !== 0
      )
    ) {
      throw new Error(
        "Manual allocation does not support income, spending, or other funds in the next month"
      );
    }

    return document;
  });

  const dependencies = [root, ...documents.values()].filter((entry) => entry !== null);

  return {
    accounts,
    budget,
    category,
    config,
    dependencies,
    future,
    index,
    period,
    root,
    selected,
  };
}

export type ManualSnapshot = Awaited<ReturnType<typeof readManualSnapshot>>;

export function compileManualAllocation(
  snapshot: ManualSnapshot,
  categoryId: string,
  intent: AllocationIntent,
  metadata: { createdAt: string; historyId: string; markerId: string }
) {
  const summary = calculateManualAllocation(
    {
      accounts: z.object({ data: DataSchema }).parse(snapshot.accounts.data).data,
      categoryId,
      currencyCode: snapshot.config.currencyCode,
      index: z.object({ data: DataSchema }).parse(snapshot.index.data).data,
      period: snapshot.period.data,
    },
    intent
  );

  const { createdAt, historyId, markerId } = metadata;

  if (Object.hasOwn(snapshot.budget.allocationHistory, historyId)) {
    throw new Error("Allocation history identity already exists");
  }

  const timestamp = new Date(createdAt);

  if (!Number.isFinite(timestamp.getTime())) {
    throw new TypeError("Invalid allocation timestamp");
  }

  const writes: Write[] = summary.noChange
    ? []
    : [
        patchDocument(snapshot.period, [
          { path: ["balances", categoryId, "allocatedAmount"], value: summary.after.allocation },
          { path: ["balances", categoryId, "updatedAt"], value: timestamp },
          { path: ["balances", categoryId, "lastUpdateChangeSource"], value: "USER" },
        ]),
        patchDocument(snapshot.category, [
          {
            path: ["data", "historicalAllocations", snapshot.selected.yearMonth],
            value: summary.after.allocation,
          },
        ]),
        patchDocument(snapshot.root, [
          {
            path: ["allocationHistory", historyId],
            value: {
              accountId: "",
              afterAmount: summary.after.allocation,
              beforeAmount: summary.before.allocation,
              categoryId,
              createdAt: timestamp,
              id: historyId,
              linkedCategoryId: "",
              periodId: snapshot.selected.id,
              source: "MANUAL",
              undoneAt: null,
              ...summary.history,
            },
          },
          { path: ["changeSource"], value: "USER" },
        ]),
        {
          currentDocument: { exists: false },
          update: {
            fields: {
              expireAt: {
                timestampValue: new Date(timestamp.getTime() + 30 * 86_400_000).toISOString(),
              },
            },
            name: `${snapshot.root.name}/saveMarkers/${markerId}`,
          },
          updateTransforms: [{ fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" }],
        },
      ];

  if (
    Buffer.byteLength(JSON.stringify(snapshot.root.raw)) +
      Buffer.byteLength(JSON.stringify(writes[2] ?? {})) >
    950_000
  ) {
    throw new Error("Allocation history approaches the budget document size limit");
  }

  return { summary, writes };
}

export function buildAllocationPlan(
  client: BeyondClient,
  snapshot: ManualSnapshot,
  categoryId: string,
  intent: AllocationIntent,
  metadata: { createdAt: string; historyId: string; markerId: string }
) {
  const { summary, writes } = compileManualAllocation(snapshot, categoryId, intent, metadata);

  const body = PlanBodySchema.parse({
    actor: client.session.uid,
    budgetId: client.budgetId,
    categoryId,
    createdAt: metadata.createdAt,
    database: "(default)",
    historyId: metadata.historyId,
    intent,
    markerId: metadata.markerId,
    month: snapshot.selected.yearMonth,
    projectId: client.session.projectId,
    sources: snapshot.dependencies
      .map((document) => ({ document: document.name, updateTime: document.updateTime }))
      .toSorted((a, b) => a.document.localeCompare(b.document)),
    summary,
    version: 1,
    writes,
  });

  return { ...body, hash: allocationHash(body) };
}

export async function previewManualAllocation(
  client: BeyondClient,
  categoryId: string,
  month: string,
  intent: AllocationIntent,
  now = new Date()
) {
  const transaction = await FirestoreTransaction.begin(client, "read");

  try {
    const snapshot = await readManualSnapshot(client, transaction, month, categoryId, now);

    return buildAllocationPlan(client, snapshot, categoryId, intent, {
      createdAt: now.toISOString(),
      historyId: newId(),
      markerId: newId(),
    });
  } finally {
    await transaction.rollback();
  }
}
