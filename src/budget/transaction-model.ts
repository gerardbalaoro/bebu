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

export const TransactionDeleteScopeSchema = z.enum(["THIS_PAYMENT", "THIS_AND_LATER"]);
export const TransactionDeleteSchema = z.object({ scope: TransactionDeleteScopeSchema.optional() });

export type TransactionDeleteOptions = CommitOptions & z.infer<typeof TransactionDeleteSchema>;

export const TransactionCreateSchema = z.strictObject({
  accountId: ObjectIdSchema,
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  categoryId: ObjectIdSchema.optional(),
  cleared: z.boolean().optional(),
  color: z.string().optional(),
  completed: z.boolean().optional(),
  dueAt: z.iso.datetime({ offset: true }).optional(),
  id: z
    .string()
    .regex(/^[A-Za-z0-9]{20}$/u)
    .optional(),
  notes: z.string().max(400).optional(),
  payeeId: ObjectIdSchema.optional(),
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
    frequency: z
      .enum([
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
      ])
      .optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    nonWorkingDayPolicy: z
      .enum([
        "KEEP_ORIGINAL_DATE",
        "SHIFT_TO_NEXT_AVAILABLE_WORKDAY",
        "SHIFT_TO_PREVIOUS_AVAILABLE_WORKDAY",
      ])
      .optional(),
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

const QueryDocumentSchema = z.object({ fields: DataSchema.default({}) });
export const QueryRowsSchema = z.array(z.object({ document: QueryDocumentSchema.optional() }));

export const CollectionSchema = z.object({
  documents: z.array(QueryDocumentSchema).default([]),
  nextPageToken: z.string().optional(),
});

export const decodeTransaction = (fields: Data): Transaction =>
  TransactionSchema.parse(
    Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]))
  );

export type TransactionCreate = z.input<typeof TransactionCreateSchema>;

export type TransactionPatch = z.infer<typeof TransactionPatchSchema>;
