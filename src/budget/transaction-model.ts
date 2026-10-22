import { z } from "zod";

import { DataSchema, decode } from "../firestore/encoding.ts";
import type { Data } from "../firestore/encoding.ts";

export const ObjectIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u);

const TargetSchema = z.object({
  id: ObjectIdSchema,
  linkedObjectId: z.string().nullable(),
  linkedObjectType: z.string().nullable(),
  type: z.string(),
});

export type Target = z.infer<typeof TargetSchema>;

export const TransactionSchema = z.looseObject({
  amount: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
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
  offsetAdjustment: z.number(),
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
  type: z.enum(["OUTFLOW", "INFLOW"]).default("OUTFLOW"),
});

export const TransactionPatchSchema = z
  .strictObject({
    cleared: z.boolean().optional(),
    color: z.string().optional(),
    notes: z.string().max(400).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide notes, color, or cleared");

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
