/* oxlint-disable func-style, no-await-in-loop -- Named audit functions keep ordered period comparisons together. */
import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema } from "../firestore/encoding.ts";
import type { Data, FirestoreDocument } from "../firestore/encoding.ts";
import { FirestoreTransaction } from "../firestore/transaction.ts";
import { CategoriesSchema } from "./model.ts";
import type { Category } from "./model.ts";
import { ObjectIdSchema } from "./transaction-model.ts";

export const CarryoverMonthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u);

export interface CarryoverPeriod {
  yearMonth: string;
  periodId: string;
  balances: Record<string, Data>;
}

interface CarryoverComparison {
  categoryId: string;
  fromMonth: string;
  toMonth: string;
  currentCarryOverStrategy: string | null;
  previousAvailableAmount: number | null;
  storedCarriedOverAmount: number | null;
  residualAmount: number | null;
  status: "continuous" | "discontinuity" | "unknown";
  reasons: string[];
}

function nextMonth(month: string) {
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5));

  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
}

const AuditAmountSchema = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

const AuditOperandsSchema = z.object({
  allocatedAmount: AuditAmountSchema,
  carriedOverAmount: AuditAmountSchema,
  otherAmount: AuditAmountSchema,
  spentAmount: AuditAmountSchema,
});

function compareCarryover(
  category: Category | undefined,
  id: string,
  before: CarryoverPeriod,
  after: CarryoverPeriod
): CarryoverComparison {
  const strategy = z.string().safeParse(category?.carryOverStrategy).data ?? null;

  const row: CarryoverComparison = {
    categoryId: id,
    currentCarryOverStrategy: strategy,
    fromMonth: before.yearMonth,
    previousAvailableAmount: null,
    reasons: [],
    residualAmount: null,
    status: "unknown",
    storedCarriedOverAmount: null,
    toMonth: after.yearMonth,
  };

  if (nextMonth(before.yearMonth) !== after.yearMonth) {
    row.reasons.push("missing-intermediate-month");
  }

  if (strategy !== "ALL") {
    row.reasons.push("current-policy-is-not-explicit-ALL");
  }

  if (category?.type !== "DEFAULT") {
    row.reasons.push("category-type-is-not-ordinary");
  }

  if (category?.id !== id) {
    row.reasons.push("category-identity-is-unknown-or-inconsistent");
  }

  const previous = AuditOperandsSchema.safeParse(before.balances[id]);
  const stored = AuditAmountSchema.safeParse(after.balances[id]?.carriedOverAmount);

  if (!previous.success) {
    row.reasons.push(
      ...previous.error.issues.map(
        (issue) => `unknown-or-unsafe-previous-${issue.path.join(".") || "balance"}`
      )
    );
  }

  if (stored.success) {
    row.storedCarriedOverAmount = stored.data;
  } else {
    row.reasons.push("unknown-or-unsafe-next-carriedOverAmount");
  }

  if (!previous.success || !stored.success || row.reasons.length > 0) {
    return row;
  }

  const { allocatedAmount, carriedOverAmount, otherAmount, spentAmount } = previous.data;

  const available =
    BigInt(allocatedAmount) + BigInt(carriedOverAmount) + BigInt(otherAmount) - BigInt(spentAmount);

  const residual = BigInt(stored.data) - available;

  if (!Number.isSafeInteger(Number(available)) || !Number.isSafeInteger(Number(residual))) {
    row.reasons.push("unsafe-available-or-residual-amount");

    return row;
  }

  return {
    ...row,
    previousAvailableAmount: Number(available),
    residualAmount: Number(residual),
    status: residual === 0n ? "continuous" : "discontinuity",
  };
}

export function auditCarryover(
  categories: Record<string, Category>,
  periods: CarryoverPeriod[],
  categoryIds?: string[]
) {
  const ordered = periods.toSorted((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const months = ordered.map((period) => CarryoverMonthSchema.parse(period.yearMonth));

  if (
    new Set(months).size !== months.length ||
    new Set(periods.map((p) => p.periodId)).size !== periods.length
  ) {
    throw new Error("Carryover audit requires unique saved months and period IDs");
  }

  const ids = [
    ...new Set(
      categoryIds ?? [
        ...Object.keys(categories),
        ...periods.flatMap((period) => Object.keys(period.balances)),
      ]
    ),
  ].toSorted();

  const comparisons: CarryoverComparison[] = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const before = ordered[index - 1];
    const after = ordered[index];

    if (!before || !after) {
      continue;
    }

    for (const id of ids) {
      comparisons.push(compareCarryover(categories[id], id, before, after));
    }
  }

  return {
    comparisons,
    executionSupported: false,
    historicalPolicyKnown: false,
    propagationVerified: false,
    readOnly: true,
    totals: {
      comparisons: comparisons.length,
      continuous: comparisons.filter((row) => row.status === "continuous").length,
      discontinuities: comparisons.filter((row) => row.status === "discontinuity").length,
      unknown: comparisons.filter((row) => row.status === "unknown").length,
    },
  };
}

export const CarryoverOptionsSchema = z.strictObject({
  categoryId: ObjectIdSchema.optional(),
  fromMonth: CarryoverMonthSchema.optional(),
  throughMonth: CarryoverMonthSchema.optional(),
});

export async function categoryCarryover(
  client: BeyondClient,
  value: z.infer<typeof CarryoverOptionsSchema> = {}
) {
  const options = CarryoverOptionsSchema.parse(value);

  if (
    options.fromMonth !== undefined &&
    options.throughMonth !== undefined &&
    options.fromMonth > options.throughMonth
  ) {
    throw new Error("from-month must not follow through-month");
  }

  const snapshot = await FirestoreTransaction.begin(client, "read");

  try {
    const root = await client.discover(snapshot);

    const months = Object.keys(root.data.availablePeriods)
      .map((month) => CarryoverMonthSchema.parse(month))
      .filter(
        (month) =>
          (options.fromMonth === undefined || month >= options.fromMonth) &&
          (options.throughMonth === undefined || month <= options.throughMonth)
      )
      .toSorted();

    const index = await snapshot.document(
      `${client.budgetPath}/stashes/${client.stashId("GROUPS_AND_CATEGORIES")}`,
      CategoriesSchema
    );

    const paths = months.map(
      (month) =>
        `${client.budgetPath}/periods/${ObjectIdSchema.parse(root.data.availablePeriods[month]?.id)}`
    );

    if (new Set(paths).size !== paths.length) {
      throw new Error("Saved months share a period identity");
    }

    const documents =
      paths.length > 0 ? await snapshot.read(paths) : new Map<string, FirestoreDocument | null>();

    const periods = months.map((month, offset): CarryoverPeriod => {
      const path = paths[offset] ?? "";
      const doc = documents.get(path);

      if (!doc) {
        throw new Error(`Required carryover period is missing: ${month}`);
      }

      if (
        (doc.data.id !== undefined && doc.data.id !== root.data.availablePeriods[month]?.id) ||
        (doc.data.yearMonth !== undefined && doc.data.yearMonth !== month)
      ) {
        throw new Error(`Carryover period identity mismatch: ${month}`);
      }

      return {
        balances: z.record(z.string(), DataSchema).parse(doc.data.balances ?? {}),
        periodId: ObjectIdSchema.parse(root.data.availablePeriods[month]?.id),
        yearMonth: month,
      };
    });

    if (
      options.categoryId !== undefined &&
      !index.data.data.categories[options.categoryId] &&
      !periods.some((p) => p.balances[options.categoryId ?? ""])
    ) {
      throw new Error("Category not found in the index or saved periods");
    }

    return {
      ...auditCarryover(
        index.data.data.categories,
        periods,
        options.categoryId === undefined ? undefined : [options.categoryId]
      ),
      months,
      snapshotConsistent: true,
      sources: [root, index, ...documents.values()].flatMap((doc) =>
        doc ? [{ document: doc.name, updateTime: doc.updateTime }] : []
      ),
    };
  } finally {
    try {
      await snapshot.rollback();
    } catch {
      // Preserve the original audit outcome.
    }
  }
}
