import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema, patchDocument } from "../firestore/encoding.ts";
import type { CommitOptions } from "../firestore/encoding.ts";
import { FirestoreTransaction } from "../firestore/transaction.ts";
import { ObjectIdSchema } from "./transaction-model.ts";

const NameSchema = z.string().trim().min(1).max(200);
const KindSchema = z.enum(["category", "group"]);

const IndexSchema = z.looseObject({
  data: z.looseObject({
    categories: z.record(z.string(), DataSchema),
    groups: z.record(z.string(), DataSchema),
  }),
});

// Native 50480/50452 and 50583/50582 change the name in the shared index only.
export class StructureService {
  readonly client: BeyondClient;
  constructor(client: BeyondClient) {
    this.client = client;
  }
  async groups() {
    const index = await this.client.stash("GROUPS_AND_CATEGORIES", IndexSchema);

    return Object.values(index.data.data.groups);
  }
  async rename(
    kind: z.infer<typeof KindSchema>,
    id: string,
    value: string,
    options: CommitOptions = {}
  ) {
    KindSchema.parse(kind);
    ObjectIdSchema.parse(id);
    const name = NameSchema.parse(value);

    const snapshot = await FirestoreTransaction.begin(
      this.client,
      options.dryRun === true ? "read" : "write"
    );

    try {
      await this.client.discover(snapshot);

      const index = await snapshot.document(
        `${this.client.budgetPath}/stashes/${ObjectIdSchema.parse(this.client.stashId("GROUPS_AND_CATEGORIES"))}`,
        IndexSchema
      );

      const collection = kind === "category" ? "categories" : "groups";
      const record = index.data.data[collection][id];

      if (record === undefined) {
        throw new Error(`${kind} not found`);
      }

      if (record.id !== id) {
        throw new Error(`${kind} identity does not match the index key`);
      }

      if (
        record.modifiable !== true ||
        record.deleted === true ||
        record.archived === true ||
        record.type !== "DEFAULT"
      ) {
        throw new Error("Rename supports active DEFAULT records with explicit modifiable:true");
      }

      const before = z.string().parse(record.name);
      const summary = { financialChanges: false, id, kind, name: { after: name, before } };

      if (before === name) {
        return { changed: false, committed: false, summary };
      }

      const result = await this.client.commit(
        [patchDocument(index, [{ path: ["data", collection, id, "name"], value: name }])],
        options,
        snapshot
      );

      if ("alreadyCommitted" in result) {
        throw new Error(
          "Rename has marker-only confirmation. Inspect the current name before another command"
        );
      }

      return { ...result, changed: true, summary };
    } finally {
      try {
        await snapshot.rollback();
      } catch {
        /* Preserve the operation's original outcome. */
      }
    }
  }
}
