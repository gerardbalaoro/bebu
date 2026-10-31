import { z } from "zod";

import type { Transaction, TransactionPatch } from "./transaction-model.ts";
import type { TransactionContext } from "./transactions.ts";

const DayMilliseconds = 86_400_000;

const MonthlyFrequencies = new Set([
  "MONTHLY",
  "TWO_MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "ANNUALLY",
  "BIENNIALLY",
]);

const calendarTime = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    fractionalSecondDigits: 3,
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(date);

  const fields = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  const local = new Date(0);
  local.setUTCFullYear(fields.year ?? 0, (fields.month ?? 1) - 1, fields.day ?? 1);
  local.setUTCHours(
    fields.hour ?? 0,
    fields.minute ?? 0,
    fields.second ?? 0,
    fields.fractionalSecond ?? 0
  );

  return local;
};

// Match the requested wall time across offset changes. Reject a missing or ambiguous local time.
const timestampFor = (local: Date, timezone: string) => {
  const candidates = new Set<number>();

  for (const days of [-2, 0, 2]) {
    const sample = local.getTime() + days * DayMilliseconds;
    const offset = calendarTime(new Date(sample), timezone).getTime() - sample;
    const candidate = local.getTime() - offset;

    if (calendarTime(new Date(candidate), timezone).getTime() === local.getTime()) {
      candidates.add(candidate);
    }
  }

  if (candidates.size !== 1) {
    throw new Error(
      "The schedule falls at a missing or ambiguous local time. Choose another timestamp"
    );
  }

  return new Date([...candidates][0] ?? Number.NaN).toISOString();
};

const logicalDate = (transaction: Transaction) => {
  const local = calendarTime(new Date(transaction.dueAt), transaction.timezone);
  local.setUTCDate(local.getUTCDate() - transaction.offsetAdjustment);

  return local;
};

const workdayOffset = (date: Date, policy: string, today: string) => {
  const day = date.getUTCDay();

  if (policy === "KEEP_ORIGINAL_DATE" || (day !== 0 && day !== 6)) {
    return 0;
  }

  const next = day === 6 ? 2 : 1;

  if (policy === "SHIFT_TO_NEXT_AVAILABLE_WORKDAY") {
    return next;
  }

  const previous = day === 6 ? -1 : -2;
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + previous);

  return shifted.toISOString().slice(0, 10) < today ? next : previous;
};

const editRepeatRules = (before: Transaction, after: Transaction, input: TransactionPatch) => {
  const frequencyChanged = input.frequency !== undefined && input.frequency !== before.frequency;

  if (frequencyChanged) {
    after.sequenceCount = 1;
    after.repeatCount = null;
  }

  if (input.repeatCount !== undefined) {
    const sequence = z
      .number()
      .int()
      .nonnegative()

      .parse(after.sequenceCount ?? 0);

    after.repeatCount =
      input.repeatCount === null || input.repeatCount === 0
        ? null
        : z
            .number()
            .int()

            .parse(Math.max(input.repeatCount, sequence + 1));
  }

  if (after.frequency === "ONE_OFF") {
    if (
      (input.repeatCount !== undefined && input.repeatCount !== null && input.repeatCount !== 0) ||
      (input.nonWorkingDayPolicy !== undefined &&
        input.nonWorkingDayPolicy !== "KEEP_ORIGINAL_DATE")
    ) {
      throw new Error("One-off transactions cannot have repeat rules");
    }

    after.repeatCount = null;
    after.nonWorkingDayPolicy = "KEEP_ORIGINAL_DATE";
    after.offsetAdjustment = 0;
    after.anchorDay = null;
  }
};

const normalizeSchedule = (before: Transaction, after: Transaction, input: TransactionPatch) => {
  editRepeatRules(before, after, input);

  if (after.frequency === "ONE_OFF") {
    return;
  }

  const logical =
    input.dueAt === undefined
      ? logicalDate(after)
      : calendarTime(new Date(input.dueAt), after.timezone);

  const today = calendarTime(new Date(), after.timezone).toISOString().slice(0, 10);
  const future = logical.toISOString().slice(0, 10) > today;

  const policy =
    after.frequency === "DAILY" && after.nonWorkingDayPolicy !== "KEEP_ORIGINAL_DATE"
      ? "SHIFT_TO_NEXT_AVAILABLE_WORKDAY"
      : after.nonWorkingDayPolicy;

  if (future) {
    const offset = workdayOffset(logical, policy, today);
    const adjusted = new Date(logical);
    adjusted.setUTCDate(adjusted.getUTCDate() + offset);
    after.dueAt = timestampFor(adjusted, after.timezone);
    after.offsetAdjustment = offset;
  } else if (input.dueAt !== undefined) {
    after.offsetAdjustment = 0;
  }
};

const editOccurrence = (
  before: Transaction,
  after: Transaction,
  scope: TransactionPatch["recurrenceScope"]
) => {
  if (after.frequency === "ONE_OFF") {
    after.occurrenceChange = null;

    return;
  }

  if (before.completed || before.frequency === "ONE_OFF") {
    return;
  }

  const occurrence = before.occurrenceChange ?? {
    amount: null,
    dueAt: null,
    seriesAmount: null,
    seriesAnchorAt: null,
  };

  const change = { ...occurrence };

  if (before.amount !== after.amount) {
    change.amount = scope === "THIS_PAYMENT" ? after.amount : null;

    const baseline =
      occurrence.amount === before.amount &&
      occurrence.seriesAmount !== null &&
      Math.sign(occurrence.seriesAmount) === Math.sign(before.amount)
        ? occurrence.seriesAmount
        : before.amount;

    change.seriesAmount = scope === "THIS_PAYMENT" ? baseline : null;
  }

  if (before.dueAt !== after.dueAt) {
    change.dueAt = scope === "THIS_PAYMENT" ? after.dueAt : null;

    const baseline =
      occurrence.dueAt !== null &&
      new Date(occurrence.dueAt).getTime() === new Date(before.dueAt).getTime()
        ? (occurrence.seriesAnchorAt ?? before.dueAt)
        : before.dueAt;

    change.seriesAnchorAt = scope === "THIS_PAYMENT" ? baseline : null;
  }

  const hasOverride = Object.values(change).some((value) => value !== null);

  if (hasOverride || before.occurrenceChange !== undefined) {
    after.occurrenceChange = hasOverride ? change : null;
  }
};

const editAnchor = (before: Transaction, after: Transaction) => {
  if (after.completed) {
    return;
  }

  const occurrence = after.occurrenceChange;

  const occurrenceDate = occurrence?.dueAt ?? null;
  const seriesDate = occurrence?.seriesAnchorAt ?? null;

  const usesSeriesDate =
    occurrenceDate !== null &&
    seriesDate !== null &&
    new Date(occurrenceDate).getTime() === new Date(after.dueAt).getTime();

  const logical =
    usesSeriesDate && seriesDate !== null
      ? calendarTime(new Date(seriesDate), after.timezone)
      : logicalDate(after);

  if (!MonthlyFrequencies.has(after.frequency)) {
    after.anchorDay = null;

    return;
  }

  const lastDay = new Date(logical);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  const storedAnchor = before.anchorDay ?? 0;
  const anchor = storedAnchor > 0 && storedAnchor <= 31 ? storedAnchor : null;
  after.anchorDay =
    anchor !== null && logical.getUTCDate() === Math.min(anchor, lastDay.getUTCDate())
      ? anchor
      : logical.getUTCDate();
};

const assignPeriod = (after: Transaction, context: TransactionContext) => {
  after.yearMonth = calendarTime(new Date(after.dueAt), after.timezone).toISOString().slice(0, 7);
  after.periodId = context.budget.data.availablePeriods?.[after.yearMonth]?.id ?? null;

  if (after.completed && (after.periodId === undefined || after.periodId === null)) {
    throw new Error(
      `Budget period ${after.yearMonth} does not exist. Select that month in the app`
    );
  }

  if (after.completed && new Date(after.dueAt).getTime() > Date.now() + 60_000) {
    throw new Error("A completed transaction cannot move to a future date");
  }
};

export const editSchedule = (
  before: Transaction,
  after: Transaction,
  input: TransactionPatch,
  context: TransactionContext
) => {
  const scheduleChanged = [
    input.dueAt,
    input.timezone,
    input.frequency,
    input.repeatCount,
    input.nonWorkingDayPolicy,
  ].some((value) => value !== undefined);

  if (
    input.recurrenceScope !== undefined &&
    (before.completed ||
      after.frequency === "ONE_OFF" ||
      (before.frequency === "ONE_OFF" && input.recurrenceScope === "THIS_PAYMENT"))
  ) {
    throw new Error("recurrenceScope applies to an upcoming recurring payment");
  }

  if (scheduleChanged) {
    after.timezone = input.timezone ?? before.timezone;
    after.dueAt = input.dueAt === undefined ? before.dueAt : new Date(input.dueAt).toISOString();

    if (
      before.completed &&
      (input.frequency !== undefined ||
        input.repeatCount !== undefined ||
        input.nonWorkingDayPolicy !== undefined)
    ) {
      throw new Error("Edit recurrence on the upcoming entry in the app or CLI");
    }

    if (!after.completed) {
      normalizeSchedule(before, after, input);
    }

    assignPeriod(after, context);
  }

  if (new Date(before.dueAt).getTime() === new Date(after.dueAt).getTime()) {
    after.dueAt = before.dueAt;
  }

  if (input.amountMinor !== undefined || scheduleChanged || input.recurrenceScope !== undefined) {
    editOccurrence(before, after, input.recurrenceScope);
  }

  if (scheduleChanged) {
    editAnchor(before, after);
  }
};
