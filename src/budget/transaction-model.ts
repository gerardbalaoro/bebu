/* oxlint-disable func-style -- Named history functions follow the repository TypeScript conventions. */
import { z } from "zod";

import { DataSchema, decode } from "../firestore/encoding.ts";
import type { Data, CommitOptions } from "../firestore/encoding.ts";

export const ObjectIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u);

const TargetSchema = z.object({
  id: ObjectIdSchema,
  linkedObjectId: z.string().nullable(),
  linkedObjectType: z.string().nullable(),
  type: z.string(),
});

export type Target = z.infer<typeof TargetSchema>;

const OccurrenceChangeSchema = z.object({
  amount: z.number().int().nullable().default(null),
  dueAt: z.string().nullable().default(null),
  seriesAmount: z.number().int().nullable().default(null),
  seriesAnchorAt: z.string().nullable().default(null),
});

export const TransactionSchema = z.looseObject({
  amount: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  anchorDay: z.number().int().nullish(),
  autoAllocateIfCapable: z.boolean(),
  autoAllocateIfIncome: z.boolean().optional(),
  budgetId: z.string(),
  cleared: z.boolean(),
  clonedToTransactionId: z.string().nullish(),
  color: z.string(),
  completed: z.boolean(),
  createdAt: z.string(),
  createdBy: z.object({
    displayName: z.string(),
    email: z.string().nullable(),
    photoUrl: z.string(),
    uid: z.string(),
  }),
  dueAt: z.string(),
  editable: z.boolean(),
  eventId: z.string().nullable(),
  externalId: z.string().nullable(),
  extraTarget: TargetSchema.nullable(),
  extras: DataSchema,
  files: z.array(z.unknown()),
  frequency: z.string(),
  id: ObjectIdSchema,
  integrityCount: z.number(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  nonWorkingDayPolicy: z.string(),
  notes: z.string(),
  occurrenceChange: OccurrenceChangeSchema.nullish(),
  offsetAdjustment: z.number().int(),
  payee: TargetSchema.nullable(),
  periodId: ObjectIdSchema.nullish(),
  reconciled: z.boolean(),
  reconciledAt: z.string().nullish(),
  reminderDescription: z.string().nullable(),
  reminderEnabled: z.boolean(),
  reminderName: z.string().nullable(),
  repeatCount: z.number().nullable(),
  sentiment: z.string(),
  sequenceCount: z.number().nullable(),
  siblingTransactionId: z.string().nullable(),
  splitId: z.string().nullable(),
  subType: z.string().nullable(),
  tagIds: z.array(z.string()),
  targetFrom: TargetSchema.nullable(),
  targetTo: TargetSchema.nullable(),
  timezone: z.string(),
  type: z.string(),
  version: z.number().nullable(),
  yearMonth: z.string(),
});

export type Transaction = z.infer<typeof TransactionSchema>;

// History can omit legacy values. Only TransactionSchema admits records to write planning.
const HistoryTargetSchema = TargetSchema.partial().loose();

const HistoryTransactionSchema = TransactionSchema.partial().extend({
  createdBy: TransactionSchema.shape.createdBy.partial().loose().nullish(),
  extraTarget: HistoryTargetSchema.nullable().optional(),
  occurrenceChange: z
    .looseObject({
      amount: OccurrenceChangeSchema.shape.amount.unwrap().optional(),
      dueAt: OccurrenceChangeSchema.shape.dueAt.unwrap().optional(),
      seriesAmount: OccurrenceChangeSchema.shape.seriesAmount.unwrap().optional(),
      seriesAnchorAt: OccurrenceChangeSchema.shape.seriesAnchorAt.unwrap().optional(),
    })
    .nullish(),
  payee: HistoryTargetSchema.nullable().optional(),
  targetFrom: HistoryTargetSchema.nullable().optional(),
  targetTo: HistoryTargetSchema.nullable().optional(),
});

interface HistoryIssue {
  code: string;
  path: PropertyKey[];
  message: string;
}

export function readTransactionHistory(documents: z.infer<typeof QueryDocumentSchema>[]) {
  const transactions: z.infer<typeof HistoryTransactionSchema>[] = [];
  const invalidRecords: { document?: string; data?: Data; fields?: Data }[] = [];

  const diagnostics: {
    document?: string;
    transactionId?: string;
    issues: HistoryIssue[];
  }[] = [];

  for (const document of documents) {
    const data: Data = {};
    const issues: HistoryIssue[] = [];

    for (const [key, value] of Object.entries(document.fields)) {
      try {
        data[key] = decode(value);
      } catch (error) {
        issues.push({
          code: "decode_error",
          message: error instanceof Error ? error.message : "Cannot decode Firestore field",
          path: [key],
        });
      }
    }

    if (issues.length > 0) {
      invalidRecords.push({ document: document.name, fields: document.fields });
      diagnostics.push({
        document: document.name,
        issues,
        transactionId: z.string().safeParse(data.id).data,
      });
      continue;
    }

    const history = HistoryTransactionSchema.safeParse(data);
    const strict = TransactionSchema.safeParse(data);

    if (history.success) {
      transactions.push(history.data);
    } else {
      invalidRecords.push({ data, document: document.name });
    }

    if (!strict.success) {
      diagnostics.push({
        document: document.name,
        issues: strict.error.issues.map(({ code, path, message }) => ({ code, message, path })),
        transactionId: z.string().safeParse(data.id).data,
      });
    }
  }

  return { diagnostics, invalidRecords, transactions };
}

export const TransactionDeleteScopeSchema = z.enum(["THIS_PAYMENT", "THIS_AND_LATER"]);
export const TransactionDeleteSchema = z.object({ scope: TransactionDeleteScopeSchema.optional() });

export type TransactionDeleteOptions = CommitOptions & z.infer<typeof TransactionDeleteSchema>;

export const TransactionFrequencySchema = z.enum([
  "ONE_OFF",
  "DAILY",
  "WEEKLY",
  "FORTNIGHTLY",
  "FOUR_WEEKLY",
  "MONTHLY",
  "TWO_MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "ANNUALLY",
  "BIENNIALLY",
]);

export const TransactionWorkdayPolicySchema = z.enum([
  "KEEP_ORIGINAL_DATE",
  "SHIFT_TO_NEXT_AVAILABLE_WORKDAY",
  "SHIFT_TO_PREVIOUS_AVAILABLE_WORKDAY",
]);

export const TransactionCreateSchema = z.strictObject({
  accountId: ObjectIdSchema,
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  categoryId: ObjectIdSchema.optional(),
  cleared: z.boolean().optional(),
  color: z.string().optional(),
  completed: z.boolean().optional(),
  dueAt: z.iso.datetime({ offset: true }).optional(),
  frequency: TransactionFrequencySchema.optional(),
  id: z
    .string()
    .regex(/^[A-Za-z0-9]{20}$/u)
    .optional(),
  nonWorkingDayPolicy: TransactionWorkdayPolicySchema.optional(),
  notes: z.string().max(400).optional(),
  payeeId: ObjectIdSchema.optional(),
  repeatCount: z.number().int().nonnegative().nullable().optional(),
  tagIds: z.array(ObjectIdSchema).optional(),
  timezone: z.string().optional(),
  type: z.enum(["OUTFLOW", "INFLOW", "REFUND"]).default("OUTFLOW"),
});

export const TransactionPatchSchema = z
  .strictObject({
    accountId: ObjectIdSchema.optional(),
    amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    categoryId: ObjectIdSchema.optional(),
    cleared: z.boolean().optional(),
    color: z.string().optional(),
    dueAt: z.iso.datetime({ offset: true }).optional(),
    frequency: TransactionFrequencySchema.optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    nonWorkingDayPolicy: TransactionWorkdayPolicySchema.optional(),
    notes: z.string().max(400).optional(),
    payeeId: ObjectIdSchema.nullable().optional(),
    recurrenceScope: z.enum(["THIS_PAYMENT", "THIS_AND_LATER"]).optional(),
    reminderDescription: z.string().nullable().optional(),
    reminderEnabled: z.boolean().optional(),
    reminderName: z.string().nullable().optional(),
    repeatCount: z.number().int().nonnegative().nullable().optional(),
    sentiment: z.enum(["NONE", "THUMBS_UP", "THUMBS_DOWN"]).optional(),
    tagIds: z
      .array(ObjectIdSchema)
      .refine((ids) => new Set(ids).size === ids.length, "tagIds must be unique")
      .optional(),
    timezone: z.string().min(1).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one transaction field");

export const UserSchema = z.looseObject({
  config: z
    .looseObject({ currencyCode: z.string().optional(), timezone: z.string().optional() })
    .optional(),
  displayName: z.string().optional(),
  photoUrl: z.string().optional(),
});

const QueryDocumentSchema = z.object({
  fields: DataSchema.default({}),
  name: z.string().optional(),
});

export const QueryRowsSchema = z.array(z.object({ document: QueryDocumentSchema.optional() }));

export const CollectionSchema = z.object({
  documents: z.array(QueryDocumentSchema).default([]),
  nextPageToken: z.string().optional(),
});

export type TransactionCreate = z.input<typeof TransactionCreateSchema>;

export type TransactionPatch = z.infer<typeof TransactionPatchSchema>;
