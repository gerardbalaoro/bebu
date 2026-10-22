import { z } from "zod";

import type { TargetDemandInput } from "./target-demand.ts";

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const money = z.number().int().safe();
const nonnegative = (value: bigint) => (value > 0n ? value : 0n);

const localDate = (timestamp: string, timezone: string): CalendarDate => {
  z.iso.datetime({ offset: true }).parse(timestamp);

  const parts = new Intl.DateTimeFormat("en-US", {
    calendar: "gregory",
    day: "numeric",
    era: "short",
    month: "numeric",
    numberingSystem: "latn",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date(timestamp));

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);

  if (values.era !== "AD" || year < 1 || year > 9999) {
    throw new Error("Savings dates must use years 0001 through 9999");
  }

  return { day: Number(values.day), month: Number(values.month), year };
};

// Native 53449 counts complete calendar months, including the day adjustment in both directions.
const monthsBetween = (a: CalendarDate, b: CalendarDate): number => {
  const months = 12 * (b.year - a.year) + b.month - a.month;

  if (months > 0 && b.day < a.day) {
    return months - 1;
  }

  if (months < 0 && b.day > a.day) {
    return months + 1;
  }

  return months;
};

export const savingsTargetDemand = (input: TargetDemandInput): number => {
  const { category, balance } = input;

  const target = z
    .object({
      amount: money,
      createdAt: z.string(),
      dynamicSavingsTarget: z.boolean(),
      endAt: z.string().nullable(),
      repeatIntervalMonths: z.null(),
    })
    .parse(category.target);

  if (!input.calculationTimezone) {
    throw new Error(
      "Savings preview requires --calculation-timezone matching the native app device timezone"
    );
  }

  const timezone = input.calculationTimezone;
  const created = localDate(target.createdAt, timezone);

  const selected = {
    day: 1,
    month: Number(input.yearMonth.slice(5)),
    year: Number(input.yearMonth.slice(0, 4)),
  };

  if (selected.year < 1) {
    throw new Error("Savings month must use years 0001 through 9999");
  }

  let allocated = BigInt(balance.allocatedAmount);

  if (category.aggregateAllocationForTarget) {
    for (const child of input.directChildren) {
      allocated += nonnegative(BigInt(child.allocatedAmount));
    }
  }

  let available =
    allocated + BigInt(money.parse(balance.otherAmount)) - BigInt(money.parse(balance.spentAmount));

  if (category.carryOverStrategy === "ALL") {
    available += BigInt(balance.carriedOverAmount);
  }

  const amount = BigInt(target.amount);

  if (target.endAt === null) {
    return money.parse(Number(nonnegative(amount - available)));
  }

  const end = localDate(target.endAt, timezone);

  if (new Date(target.endAt).getTime() < new Date(target.createdAt).getTime()) {
    throw new Error("Savings preview does not support a deadline before creation");
  }

  if (target.dynamicSavingsTarget) {
    const remainingMonths = BigInt(Math.max(monthsBetween(selected, end), 1));

    return money.parse(
      Number(nonnegative(nonnegative(amount - available) / remainingMonths - allocated))
    );
  }

  const total = monthsBetween(created, end) + 1;
  const elapsed = monthsBetween({ ...created, day: 1 }, selected) + 1;
  const installment = amount / BigInt(Math.max(total, 1));

  // Native 49245 corrects the remainder only at equality; later months return to installment * total.
  const goal =
    elapsed === total ? amount : installment * BigInt(Math.max(Math.min(elapsed, total), 0));

  return money.parse(Number(nonnegative(goal - available)));
};
