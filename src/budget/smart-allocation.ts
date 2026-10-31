import { allocationMoney, targetInputCategory } from "./allocation-model.ts";
import type { allocationModel } from "./allocation-model.ts";
import { distributeAllocation } from "./allocation-planner.ts";
import { calculateTargetDemand } from "./target-demand.ts";

// Only the empty-upcoming subset is admitted by the coordinator. Do not apply this ordering to bills.
export const planSmartAllocation = (
  model: ReturnType<typeof allocationModel>,
  yearMonth: string,
  allowPartial: boolean
) => {
  const candidates = model.categories
    .map(({ category, balance }) => {
      // Target-only eligibility replaces nonpositive target demand with zero. Smart can still
      // fund it after skipping overspending, so reject until its raw demand is handled separately.
      if (category.target !== null && category.target.amount <= 0) {
        throw new Error(`Smart preview does not support nonpositive targets: ${category.id}`);
      }

      if (
        category.accumulationStrategy === "FUND_OVERRUNS" ||
        category.target?.snoozeSchedule[yearMonth] === true
      ) {
        throw new Error(
          `Smart preview does not support fund-overruns or snoozed targets: ${category.id}`
        );
      }

      if (category.target?.type === "SAVINGS") {
        throw new Error(
          `Smart preview supports monthly spending and ongoing savings targets only: ${category.id}`
        );
      }

      const target = calculateTargetDemand({
        balance,
        category: targetInputCategory(category),
        directChildren: [],
        yearMonth,
      });

      if (target.status === "unsupported") {
        throw new Error(`Unsupported smart target for ${category.id}: ${target.reason}`);
      }

      const carry = category.carryOverStrategy === "ALL" ? BigInt(balance.carriedOverAmount) : 0n;

      const availableAmount = allocationMoney.parse(
        Number(
          BigInt(balance.allocatedAmount) +
            BigInt(balance.otherAmount) -
            BigInt(balance.spentAmount) +
            carry
        )
      );

      const eligible =
        category.type !== "INCOME" &&
        category.amountComputationStrategy !== "SKIP" &&
        (target.eligible || availableAmount < 0);

      return {
        availableAmount,
        beforeAmount: balance.allocatedAmount,
        categoryId: category.id,
        dayOfMonth: target.dayOfMonth,
        dayOfWeekOrdinal: target.dayOfWeekOrdinal,
        eligible,
        overspendingRequest: eligible ? Math.max(-availableAmount, 0) : 0,
        targetRequest: eligible ? target.requestedAmount : 0,
      };
    })
    .toSorted((a, b) => {
      const deficitA = a.availableAmount < 0 ? a.availableAmount : Number.MAX_SAFE_INTEGER;
      const deficitB = b.availableAmount < 0 ? b.availableAmount : Number.MAX_SAFE_INTEGER;

      return (
        deficitA - deficitB ||
        (a.dayOfWeekOrdinal ?? 7) - (b.dayOfWeekOrdinal ?? 7) ||
        (a.dayOfMonth ?? 32) - (b.dayOfMonth ?? 32)
      );
    });

  const funded = new Map<string, { amount: number; phase: "overspending" | "targets" }>();
  let remaining = Math.max(model.pool.availableAmount, 0);
  const phases = [];

  for (const phase of ["overspending", "targets"] as const) {
    const demands = candidates
      .filter((c) => c.eligible && !funded.has(c.categoryId))
      .map((c) => ({
        categoryId: c.categoryId,
        requestedAmount: phase === "overspending" ? c.overspendingRequest : c.targetRequest,
      }));

    const result = distributeAllocation(remaining, demands, allowPartial);

    for (const category of result.categories) {
      // Native 51862 excludes a category after any positive callback result, including partial funding.
      if (category.amount > 0) {
        funded.set(category.categoryId, { amount: category.amount, phase });
      }
    }

    remaining = result.remainingAmount;
    phases.push({ phase, ...result });
  }

  const allocatedAmount = Math.max(model.pool.availableAmount, 0) - remaining;

  return {
    allocatedAmount,
    availableAmount: model.pool.availableAmount,
    categories: candidates.map((candidate) => {
      const funding = funded.get(candidate.categoryId);
      const amount = funding?.amount ?? 0;

      return {
        ...candidate,
        afterAmount: allocationMoney.parse(Number(BigInt(candidate.beforeAmount) + BigInt(amount))),
        amount,
        fundedPhase: funding?.phase ?? null,
      };
    }),
    phases,
    remainingAmount: allocationMoney.parse(
      Number(BigInt(model.pool.availableAmount) - BigInt(allocatedAmount))
    ),
  };
};
