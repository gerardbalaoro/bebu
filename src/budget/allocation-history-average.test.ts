import { expect, test } from "bun:test";

import { positiveHistoryAverage } from "./allocation-history-average.ts";

test("history averages preserve exact sums beyond the safe number range", () => {
  expect(positiveHistoryAverage([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 2])).toEqual({
    amount: 9_007_199_254_740_990,
    positiveMonths: 2,
  });
  expect(() => positiveHistoryAverage([1.5])).toThrow();
  expect(() => positiveHistoryAverage([Number.MAX_SAFE_INTEGER + 1])).toThrow();
});
