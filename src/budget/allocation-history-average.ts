import { z } from "zod";

// WASM 51859 counts positive periods; 51858 divides their sum by that count with integer division.
export const positiveHistoryAverage = (values: readonly number[]) => {
  const amounts = z.array(z.number().int()).parse(values);
  let sum = 0n;
  let positiveMonths = 0;

  for (const amount of amounts) {
    if (amount > 0) {
      sum += BigInt(amount);
      positiveMonths += 1;
    }
  }

  return {
    amount: positiveMonths === 0 ? 0 : Number(sum / BigInt(positiveMonths)),
    positiveMonths,
  };
};
