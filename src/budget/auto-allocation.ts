import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DocumentRoot } from "../firestore/encoding.ts";
import {
  AllocationIndexSchema,
  AllocationPeriodSchema,
  allocationModel,
  allocationMoney,
  targetInputCategory,
} from "./allocation-model.ts";
import { distributeAllocation } from "./allocation-planner.ts";
import { allocationSettings } from "./allocation-settings.ts";
import { calculateTargetDemand } from "./target-demand.ts";
import { ObjectIdSchema } from "./transaction-model.ts";

const currentMonth = (now: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(now);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}`;
};

// This preview has no save path. Static calculations do not establish carryover propagation,
// native retry identity, or a concurrency-safe commit for all source snapshots.
export const previewTargetAllocation = async (
  client: BeyondClient,
  yearMonth: string,
  now = new Date()
) => {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(yearMonth)) {
    throw new Error("Use a month in YYYY-MM format");
  }

  const budget = await client.discover();

  if (
    budget.data.id !== client.budgetId ||
    budget.data.type !== "ZERO_BASED" ||
    (budget.data.currentChallenge !== undefined && budget.data.currentChallenge !== null)
  ) {
    throw new Error(
      "Target allocation preview requires a zero-based budget with matching identity and no active challenge"
    );
  }

  const periodId = ObjectIdSchema.parse(budget.data.availablePeriods[yearMonth]?.id);

  if (Object.keys(budget.data.availablePeriods).some((month) => month > yearMonth)) {
    throw new Error("Target allocation preview requires the latest saved month");
  }

  const [index, period, user] = await Promise.all([
    client.stash("GROUPS_AND_CATEGORIES", AllocationIndexSchema),
    client.document(`${client.budgetPath}/periods/${periodId}`, AllocationPeriodSchema),
    client.document(`${DocumentRoot}/users/${ObjectIdSchema.parse(client.session.uid)}`),
  ]);

  const config = z.object({ timezone: z.string().min(1) }).parse(user.data.config);

  if (yearMonth !== currentMonth(now, config.timezone)) {
    throw new Error(
      "Target allocation preview requires the current month in the saved user timezone"
    );
  }

  if (period.data.id !== periodId || period.data.yearMonth !== yearMonth) {
    throw new Error("The allocation period identity does not match the selected month");
  }

  const settings = allocationSettings(user.data);

  if (settings.ignoreAvailable) {
    throw new Error("Target allocation preview does not support ignoring available funds");
  }

  const model = allocationModel(index.data, period.data);

  const candidates = model.categories
    .map(({ category, balance }) => {
      const demand = calculateTargetDemand({
        balance,
        category: targetInputCategory(category),
        directChildren: [],
        yearMonth,
      });

      if (demand.status === "unsupported") {
        throw new Error(`Unsupported target for ${category.id}: ${demand.reason}`);
      }

      return { beforeAmount: balance.allocatedAmount, categoryId: category.id, ...demand };
    })
    .toSorted(
      (a, b) =>
        (a.dayOfWeekOrdinal ?? Number.MAX_SAFE_INTEGER) -
          (b.dayOfWeekOrdinal ?? Number.MAX_SAFE_INTEGER) ||
        (a.dayOfMonth ?? Number.MAX_SAFE_INTEGER) - (b.dayOfMonth ?? Number.MAX_SAFE_INTEGER)
    );

  const allocation = distributeAllocation(
    Math.max(model.pool.availableAmount, 0),
    candidates.map(({ categoryId, requestedAmount }) => ({ categoryId, requestedAmount })),
    settings.allowPartial
  );

  const demands = new Map(candidates.map((candidate) => [candidate.categoryId, candidate]));

  return {
    ...allocation,
    availableAmount: model.pool.availableAmount,
    budgetId: client.budgetId,
    categories: allocation.categories.map((category) => {
      const demand = demands.get(category.categoryId);

      if (!demand) {
        throw new Error("Allocation candidate is missing");
      }

      return {
        ...category,
        afterAmount: allocationMoney.parse(
          Number(BigInt(demand.beforeAmount) + BigInt(category.amount))
        ),
        beforeAmount: demand.beforeAmount,
        eligible: demand.eligible,
        reason: demand.reason,
      };
    }),
    executionSupported: false,
    periodId,
    pool: model.pool,
    remainingAmount: allocationMoney.parse(
      Number(BigInt(model.pool.availableAmount) - BigInt(allocation.allocatedAmount))
    ),
    settings,
    settingsSource: { document: user.name, omittedFields: "native-defaults", path: "config" },
    sources: [budget, index, period, user].map((document) => ({
      document: document.name,
      updateTime: document.updateTime,
    })),
    strategy: "targets",
    yearMonth,
  };
};
