import { z } from "zod";

import { ObjectIdSchema } from "./transaction-model.ts";

const amountSchema = z.number().int();

const demandSchema = z.strictObject({
  categoryId: ObjectIdSchema,
  requestedAmount: amountSchema,
});

export type AllocationDemand = z.infer<typeof demandSchema>;

// The sequential clamp/skip behavior comes from app.wat function 51863.
// Callers own eligibility, ordering, and demand calculations; this loop does not infer them.
export const distributeAllocation = (
  availableAmount: number,
  demands: readonly AllocationDemand[],
  allowPartial: boolean
) => {
  amountSchema.nonnegative().parse(availableAmount);
  const requests = z.array(demandSchema).parse(demands);
  const ids = new Set<string>();
  let requested = 0n;

  for (const request of requests) {
    if (ids.has(request.categoryId)) {
      throw new Error(`Duplicate allocation category ${request.categoryId}`);
    }

    ids.add(request.categoryId);
    requested += BigInt(Math.max(request.requestedAmount, 0));
  }

  const requestedAmount = amountSchema.parse(Number(requested));
  let remainingAmount = availableAmount;

  const categories = requests.map((request) => {
    const needed = Math.max(request.requestedAmount, 0);
    const affordable = needed <= remainingAmount;
    const amount = allowPartial || affordable ? Math.min(needed, remainingAmount) : 0;
    remainingAmount -= amount;
    let status = "funded";

    if (needed === 0) {
      status = "not-needed";
    } else if (amount === 0) {
      status = "insufficient-funds";
    } else if (amount < needed) {
      status = "partial";
    }

    return {
      amount,
      categoryId: request.categoryId,
      requestedAmount: needed,
      shortfallAmount: needed - amount,
      status,
    };
  });

  const allocatedAmount = availableAmount - remainingAmount;

  return {
    allocatedAmount,
    availableAmount,
    categories,
    remainingAmount,
    requestedAmount,
    shortfallAmount: requestedAmount - allocatedAmount,
  };
};
