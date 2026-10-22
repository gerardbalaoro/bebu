import type { BeyondClient } from "../firestore/client.ts";
import { categoryFunding } from "./funding.ts";

const safeAmount = (amount: bigint): number => {
  const result = Number(amount);

  if (!Number.isSafeInteger(result)) {
    throw new TypeError("The allocation report total exceeds the safe integer range");
  }

  return result;
};

export const allocationReport = async (client: BeyondClient, month: string) => {
  const funding = await categoryFunding(client, month);
  let signed = 0n;
  let positive = 0n;
  const grouped = new Map<string | null, bigint>();

  for (const category of funding.categories) {
    const amount = BigInt(category.allocatedAmount);
    signed += amount;
    positive += amount > 0n ? amount : 0n;
    const nature = category.nature ?? null;
    grouped.set(nature, (grouped.get(nature) ?? 0n) + amount);
  }

  const percentage = (amount: bigint) =>
    positive === 0n || amount <= 0n ? 0 : Number((amount * 100n + positive / 2n) / positive);

  return {
    allocatedAmount: safeAmount(signed),
    categories: funding.categories.map((category) => ({
      ...category,
      percentage: percentage(BigInt(category.allocatedAmount)),
    })),
    natures: [...grouped].map(([nature, amount]) => ({
      allocatedAmount: safeAmount(amount),
      nature,
      percentage: percentage(amount),
    })),
    percentageBasis: "positive-category-allocations",
    periodId: funding.periodId,
    positiveAllocatedAmount: safeAmount(positive),
    yearMonth: funding.yearMonth,
  };
};
