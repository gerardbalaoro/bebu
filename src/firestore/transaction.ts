import { z } from "zod";

import type { BeyondClient } from "./client.ts";
import { DataSchema, DocumentRoot, WireDocumentSchema, decode, fieldPath } from "./encoding.ts";
import type { FirestoreDocument, Write } from "./encoding.ts";

const ReadResultSchema = z.union([
  z.object({ found: WireDocumentSchema }),
  z.object({ missing: z.string() }),
]);

export class FirestoreTransaction {
  private finished = false;

  private readonly client: BeyondClient;
  private readonly id: string;
  private readonly mode: "read" | "write";

  private constructor(client: BeyondClient, id: string, mode: "read" | "write") {
    this.client = client;
    this.id = id;
    this.mode = mode;
  }

  async document(path: string): Promise<FirestoreDocument>;
  async document<T>(path: string, schema: z.ZodType<T>): Promise<FirestoreDocument<T>>;
  async document(
    path: string,
    schema: z.ZodType = DataSchema
  ): Promise<FirestoreDocument<unknown>> {
    const documents = await this.read([path]);
    const document = documents.get(path);

    if (!document) {
      throw new Error(`Required transaction document is missing: ${path}`);
    }

    return { ...document, data: schema.parse(document.data) };
  }

  async query(collection: string, field: string, value: string, limit: number) {
    if (
      this.finished ||
      !/^[A-Za-z_]+$/u.test(collection) ||
      !Number.isSafeInteger(limit) ||
      limit < 1
    ) {
      throw new Error("Invalid transaction query");
    }

    const rows = await this.client.request(
      `${this.client.budgetPath}:runQuery`,
      z.array(z.object({ document: WireDocumentSchema.optional() })),
      {
        body: {
          structuredQuery: {
            from: [{ collectionId: collection }],
            limit,
            where: {
              fieldFilter: {
                field: { fieldPath: field },
                op: "EQUAL",
                value: { stringValue: value },
              },
            },
          },
          transaction: this.id,
        },
        method: "POST",
      }
    );

    const prefix = `${this.client.budgetPath}/${collection}/`;
    const names = new Set<string>();

    return rows.flatMap(({ document }) => {
      if (document === undefined) {
        return [];
      }

      if (
        !document.name.startsWith(prefix) ||
        document.name.slice(prefix.length).includes("/") ||
        names.has(document.name)
      ) {
        throw new Error("Invalid transaction query response");
      }

      names.add(document.name);

      return [
        {
          data: Object.fromEntries(
            Object.entries(document.fields).map(([key, entry]) => [key, decode(entry)])
          ),
          name: document.name,
          raw: document,
          updateTime: document.updateTime,
        },
      ];
    });
  }

  static async begin(client: BeyondClient, mode: "read" | "write") {
    const response = await client.request(
      `${DocumentRoot}:beginTransaction`,
      z.object({ transaction: z.string().min(1) }),
      {
        body: {
          options:
            mode === "write" ? { readWrite: { concurrencyMode: "OPTIMISTIC" } } : { readOnly: {} },
        },
        method: "POST",
      }
    );

    return new FirestoreTransaction(client, response.transaction, mode);
  }

  async read(paths: string[]) {
    if (this.finished || new Set(paths).size !== paths.length || paths.length === 0) {
      throw new Error("Invalid transaction read");
    }

    for (const path of paths) {
      if (
        path !== this.client.budgetPath &&
        !path.startsWith(`${this.client.budgetPath}/`) &&
        path !== `${DocumentRoot}/users/${this.client.session.uid}`
      ) {
        throw new Error("Transaction read outside the selected budget or authenticated user");
      }
    }

    const rows = await this.client.request(`${DocumentRoot}:batchGet`, z.array(ReadResultSchema), {
      body: { documents: paths, transaction: this.id },
      method: "POST",
    });

    const documents = new Map<string, FirestoreDocument | null>();

    for (const row of rows) {
      const path = "found" in row ? row.found.name : row.missing;

      if (!paths.includes(path) || documents.has(path)) {
        throw new Error("Invalid transaction response: unexpected or duplicate document");
      }

      if ("found" in row) {
        const raw = row.found;
        documents.set(path, {
          data: Object.fromEntries(
            Object.entries(raw.fields).map(([key, value]) => [key, decode(value)])
          ),
          name: raw.name,
          raw,
          updateTime: raw.updateTime,
        });
      } else {
        documents.set(path, null);
      }
    }

    if (documents.size !== paths.length) {
      throw new Error("Incomplete transaction response");
    }

    return documents;
  }

  async commit(writes: Write[]) {
    if (this.finished || this.mode !== "write" || writes.length === 0) {
      throw new Error("Invalid transaction commit");
    }

    for (const write of writes) {
      const path = write.update?.name ?? write.delete;

      if (
        path === undefined ||
        (path !== this.client.budgetPath && !path.startsWith(`${this.client.budgetPath}/`))
      ) {
        throw new Error("Transaction write outside the selected budget");
      }

      if (path === this.client.budgetPath) {
        const root = z
          .strictObject({
            currentDocument: z.strictObject({ updateTime: z.string().min(1) }),
            update: z.strictObject({
              fields: z.strictObject({
                allocationHistory: z.strictObject({
                  mapValue: z.strictObject({
                    fields: z.record(z.string().regex(/^[A-Za-z0-9]{20}$/u), z.unknown()),
                  }),
                }),
                changeSource: z.strictObject({ stringValue: z.literal("USER") }),
              }),
              name: z.literal(this.client.budgetPath),
            }),
            updateMask: z.strictObject({ fieldPaths: z.array(z.string()) }),
          })
          .parse(write);

        const ids = Object.keys(root.update.fields.allocationHistory.mapValue.fields);
        const expected = [fieldPath("allocationHistory", ids[0] ?? ""), "changeSource"].toSorted();

        if (
          ids.length !== 1 ||
          JSON.stringify(root.updateMask.fieldPaths.toSorted()) !== JSON.stringify(expected)
        ) {
          throw new Error(
            "Budget root transaction writes require one masked allocation history entry and changeSource"
          );
        }
      }
    }

    this.finished = true;

    return await this.client.request(
      `${DocumentRoot}:commit`,
      z.object({ commitTime: z.iso.datetime({ offset: true }), writeResults: z.array(DataSchema) }),
      {
        body: { transaction: this.id, writes },
        method: "POST",
      }
    );
  }

  async rollback() {
    if (this.finished) {
      return;
    }

    this.finished = true;
    await this.client.request(`${DocumentRoot}:rollback`, DataSchema, {
      body: { transaction: this.id },
      method: "POST",
    });
  }
}
