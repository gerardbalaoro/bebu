/* oxlint-disable no-use-before-define -- The value encoder and field encoder call each other recursively. */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- The wire codec validates untrusted Firestore values at its I/O boundary. */
import { randomBytes } from "node:crypto";

import { z } from "zod";

export const DocumentRoot = "projects/beyond-budget/databases/(default)/documents";
export const DataSchema = z.record(z.string(), z.unknown());

export type Data = z.infer<typeof DataSchema>;

export type WireValue =
  | { nullValue: null }
  | { stringValue: string }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { arrayValue: { values: WireValue[] } }
  | { mapValue: { fields: WireFields } };

export type WireFields = Record<string, WireValue>;

export const WireDocumentSchema = z.object({
  fields: DataSchema.default({}),
  name: z.string(),
  updateTime: z.string(),
});

export type WireDocument = z.infer<typeof WireDocumentSchema>;

export interface FirestoreDocument<T = Data> {
  name: string;
  updateTime: string;
  data: T;
  raw: WireDocument;
}

export interface FieldChange {
  path: string[];
  value: unknown;
}

export type FieldTransform =
  | { fieldPath: string; increment: { integerValue: string } }
  | { fieldPath: string; setToServerValue: "REQUEST_TIME" };

export interface Write {
  update?: { name: string; fields?: WireFields };
  delete?: string;
  updateMask?: { fieldPaths: string[] };
  currentDocument?: { exists: boolean } | { updateTime: string };
  updateTransforms?: FieldTransform[];
}

export interface CommitOptions {
  dryRun?: boolean;
  requestId?: string;
}

export type CommitResult =
  | { dryRun: true; requestId: string; body: { writes: Write[] } }
  | {
      committed: true;
      requestId: string;
      commitTime: string;
      writes?: number;
      alreadyCommitted?: true;
    };

export const newId = (): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const idLength = 20;
  const unbiasedByteLimit = 248;
  let id = "";

  while (id.length < idLength) {
    for (const byte of randomBytes(24)) {
      if (byte < unbiasedByteLimit) {
        id += alphabet.charAt(byte % alphabet.length);
      }

      if (id.length === idLength) {
        break;
      }
    }
  }

  return id;
};

const simpleFieldPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export const fieldPath = (...segments: string[]): string =>
  segments
    .map((segment) => {
      if (simpleFieldPattern.test(segment)) {
        return segment;
      }

      return `\`${segment.replaceAll("\\", "\\\\").replaceAll("`", "\\`")}\``;
    })
    .join(".");

export type DecodedValue =
  | string
  | number
  | boolean
  | null
  | DecodedValue[]
  | { [key: string]: DecodedValue };

// This is the parser for untrusted Firestore wire values.
export const decode = (value: unknown): DecodedValue => {
  const wire = DataSchema.parse(value);

  if ("nullValue" in wire) {
    return null;
  }

  if (typeof wire.stringValue === "string") {
    return wire.stringValue;
  }

  if (typeof wire.booleanValue === "boolean") {
    return wire.booleanValue;
  }

  if (typeof wire.integerValue === "string") {
    const number = Number(wire.integerValue);

    return Number.isSafeInteger(number) ? number : wire.integerValue;
  }

  if (typeof wire.doubleValue === "number") {
    return wire.doubleValue;
  }

  if (typeof wire.timestampValue === "string") {
    return wire.timestampValue;
  }

  if (typeof wire.referenceValue === "string") {
    return wire.referenceValue;
  }

  if ("arrayValue" in wire) {
    const array = z.object({ values: z.array(z.unknown()).default([]) }).parse(wire.arrayValue);

    return array.values.map(decode);
  }

  if ("mapValue" in wire) {
    const map = z.object({ fields: DataSchema.default({}) }).parse(wire.mapValue);

    return Object.fromEntries(
      Object.entries(map.fields).map(([key, child]) => [key, decode(child)])
    );
  }

  throw new Error("Unsupported Firestore value");
};

// The wire encoder validates runtime values recursively, including Date instances.
export const encode = (value: unknown): WireValue => {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new TypeError("Invalid timestamp");
    }

    return { timestampValue: value.toISOString() };
  }

  if (value === null) {
    return { nullValue: null };
  }

  if (typeof value === "string") {
    return { stringValue: value };
  }

  if (typeof value === "boolean") {
    return { booleanValue: value };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Non-finite number");
    }

    return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }

  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encode) } };
  }

  const object = DataSchema.safeParse(value);

  if (object.success) {
    return { mapValue: { fields: encodeFields(object.data) } };
  }

  throw new Error("Unsupported Firestore value");
};

export const encodeFields = (value: Data): WireFields =>
  Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)]));

export const patchDocument = (
  document: FirestoreDocument<unknown>,
  changes: FieldChange[]
): Write => {
  const fields: WireFields = {};

  for (const { path, value } of changes) {
    const leaf = path.at(-1);

    if (leaf === undefined || leaf === "") {
      throw new Error("A patch field must have a path");
    }

    let nested = fields;

    for (const segment of path.slice(0, -1)) {
      const existing = nested[segment];

      if (existing && "mapValue" in existing) {
        nested = existing.mapValue.fields;
      } else {
        const children: WireFields = {};
        nested[segment] = { mapValue: { fields: children } };
        nested = children;
      }
    }

    if (value !== undefined) {
      nested[leaf] = encode(value);
    }
  }

  return {
    currentDocument: { updateTime: document.updateTime },
    update: { fields, name: document.name },
    updateMask: { fieldPaths: changes.map((change) => fieldPath(...change.path)) },
  };
};
