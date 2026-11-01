/* oxlint-disable func-style -- Named domain functions follow repository conventions. */
/* oxlint-disable anti-slop/no-unknown-parameters -- Operation errors accept caught transport failures at the persistence boundary. */
/* oxlint-disable no-await-in-loop -- Durable ancestor synchronization is sequential. */
/* oxlint-disable max-classes-per-file -- Recovery errors and durable request ownership share this boundary. */
import { mkdir, open, readFile } from "node:fs/promises";
import nodePath from "node:path";

import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { DataSchema, DocumentRoot, newId } from "../firestore/encoding.ts";
import type { CommitOptions, CommitResult, Write } from "../firestore/encoding.ts";
import { FirestoreCommitError, FirestoreError } from "../firestore/error.ts";
import type { FirestoreTransaction } from "../firestore/transaction.ts";
import { dataHome } from "../state.ts";
import { saveAllocationFile } from "./allocation-operations.ts";
import { allocationHash } from "./allocation-plan.ts";

const MaxObservedDocuments = 50;

const ObservationWriteSchema = z.object({
  currentDocument: z
    .union([z.object({ updateTime: z.string() }), z.object({ exists: z.boolean() })])
    .optional(),
  delete: z.string().optional(),
  update: z.object({ name: z.string() }).optional(),
});

const RequestIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{20}$/u, "request-id must contain exactly 20 letters or digits");

const IntentSchema = z.strictObject({
  action: z.enum(["create", "update", "delete"]),
  input: DataSchema,
  transactionId: z.string().optional(),
});

const ManifestSchema = z.strictObject({
  actor: z.string(),
  budgetId: z.string(),
  createdAt: z.iso.datetime(),
  hash: z.string(),
  intent: IntentSchema,
  projectId: z.literal("beyond-budget"),
  version: z.literal(1),
});

const SubmissionSchema = z.strictObject({
  body: z.strictObject({ transaction: z.string().optional(), writes: z.array(DataSchema) }),
  hash: z.string(),
  intentHash: z.string(),
});

const StateSchema = z.strictObject({
  commitTime: z.string().optional(),
  diagnostic: DataSchema.optional(),
  reason: z.string().optional(),
  status: z.enum(["planning", "prepared", "sending", "committed", "rejected", "unknown"]),
});

export type TransactionIntent = z.infer<typeof IntentSchema>;

export class TransactionOperationError extends Error {
  readonly result;
  constructor(
    requestId: string,
    observation: Awaited<ReturnType<TransactionOperations["recover"]>>
  ) {
    super(
      `${observation.reason ?? "This request already has a durable operation"}. Use transaction recovery to inspect it. No financial retry was made`
    );
    this.name = "TransactionOperationError";
    this.result = { ...observation, requestId };
  }
}

// The permanent request directory is a single-sender claim, including after a crash.
// Actor scope deliberately spans budgets: changing the budget cannot reuse an identity.
export class TransactionOperations {
  private readonly client: BeyondClient;
  private readonly directory: string;
  constructor(client: BeyondClient, options: { home?: string } = {}) {
    this.client = client;
    this.directory = nodePath.join(
      options.home ?? dataHome(),
      "transaction-operations",
      allocationHash({ actor: client.session.uid, project: client.session.projectId })
    );
  }
  private path(requestId: string) {
    return nodePath.join(this.directory, RequestIdSchema.parse(requestId));
  }
  private async claim(requestId: string) {
    await mkdir(this.directory, { mode: 0o700, recursive: true });

    try {
      await mkdir(this.path(requestId), { mode: 0o700 });
    } catch (error) {
      if (z.object({ code: z.literal("EEXIST") }).safeParse(error).success) {
        return false;
      }

      throw error;
    }

    let { directory } = this;

    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- Persist every ancestor before a sender can dispatch.
      const handle = await open(directory, "r");

      // oxlint-disable-next-line no-await-in-loop -- Directory durability precedes financial sending.
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }

      const parent = nodePath.dirname(directory);

      if (parent === directory) {
        break;
      }

      directory = parent;
    }

    return true;
  }
  private async save(requestId: string, state: z.infer<typeof StateSchema>) {
    await saveAllocationFile(
      nodePath.join(this.path(requestId), "state.json"),
      StateSchema.parse(state)
    );
  }
  private async read(requestId: string) {
    try {
      const path = this.path(requestId);

      const manifest = ManifestSchema.parse(
        JSON.parse(await readFile(nodePath.join(path, "intent.json"), "utf-8"))
      );

      const { hash, ...body } = manifest;

      if (
        allocationHash(body) !== hash ||
        manifest.actor !== this.client.session.uid ||
        manifest.projectId !== this.client.session.projectId
      ) {
        throw new Error("Invalid transaction operation identity");
      }

      const state = StateSchema.parse(
        JSON.parse(await readFile(nodePath.join(path, "state.json"), "utf-8"))
      );

      let submission: z.infer<typeof SubmissionSchema> | undefined;

      try {
        submission = SubmissionSchema.parse(
          JSON.parse(await readFile(nodePath.join(path, "submission.json"), "utf-8"))
        );
      } catch (error) {
        if (
          !z.object({ code: z.literal("ENOENT") }).safeParse(error).success ||
          ["prepared", "sending", "committed", "unknown"].includes(state.status)
        ) {
          throw error;
        }
      }

      if (
        submission !== undefined &&
        (allocationHash(submission.body) !== submission.hash ||
          submission.intentHash !== manifest.hash)
      ) {
        throw new Error("Corrupt transaction submission");
      }

      return { manifest, state, submission };
    } catch (error) {
      throw new Error(
        "Transaction operation is missing, incomplete, or corrupt; never resubmit this request",
        { cause: error }
      );
    }
  }
  async operation(requestId: string) {
    const operation = await this.read(requestId);

    if (operation.manifest.budgetId !== this.client.budgetId) {
      throw new Error("Transaction request is bound to a different budget");
    }

    return { ...operation, recoveryScope: "same-installation-local-manifest", requestId };
  }
  private async observeDocuments(
    requestId: string,
    submission: z.infer<typeof SubmissionSchema> | undefined
  ) {
    const marker = `${this.client.budgetPath}/saveMarkers/${requestId}`;

    const writes = (submission?.body.writes ?? [])
      .map((write) => ObservationWriteSchema.parse(write))
      .filter((write) => (write.update?.name ?? write.delete) !== marker);

    const selected = writes.slice(0, MaxObservedDocuments);

    const documents = await Promise.all(
      selected.map(async (write) => {
        const document = write.update?.name ?? write.delete;

        if (document === undefined || !document.startsWith(`${this.client.budgetPath}/`)) {
          throw new Error("Invalid submitted observation path");
        }

        const originalPrecondition = write.currentDocument ?? null;

        try {
          const current = await this.client.document(document);

          let originalPreconditionMatches = originalPrecondition === null ? null : false;

          if (originalPrecondition !== null) {
            originalPreconditionMatches =
              "updateTime" in originalPrecondition
                ? current.updateTime === originalPrecondition.updateTime
                : originalPrecondition.exists;
          }

          return {
            document,
            exists: true,
            originalPrecondition,
            originalPreconditionMatches,
            updateTime: current.updateTime,
          };
        } catch (error) {
          if (error instanceof FirestoreError && error.status === "NOT_FOUND") {
            return {
              document,
              exists: false,
              originalPrecondition,
              originalPreconditionMatches:
                originalPrecondition === null
                  ? null
                  : "exists" in originalPrecondition && !originalPrecondition.exists,
            };
          }

          return { document, originalPrecondition, unavailable: true };
        }
      })
    );

    return {
      documentLimit: MaxObservedDocuments,
      documents,
      establishesCommitOutcome: false,
      remainingWriteObservations: Math.max(0, writes.length - selected.length),
      snapshotConsistent: false,
    };
  }
  async recover(requestId: string) {
    const operation = await this.operation(requestId);

    const base = {
      ...operation.state.diagnostic,
      commitDiagnostic: operation.state.diagnostic,
      compiledBodyPresent: operation.submission !== undefined,
      dispatchMayHaveStarted:
        operation.state.diagnostic !== undefined ||
        ["sending", "unknown", "committed"].includes(operation.state.status),
      financialRetryMade: false,
      observation: await this.observeDocuments(requestId, operation.submission),
      recoveryScope: operation.recoveryScope,
      requestId,
      submissionHash: operation.submission?.hash,
    };

    if (operation.state.status === "committed") {
      return { ...base, ...operation.state, marker: "not-inspected" };
    }

    let marker = "unavailable";

    try {
      await this.client.document(`${this.client.budgetPath}/saveMarkers/${requestId}`);
      marker = "present";
    } catch (error) {
      if (error instanceof FirestoreError && error.status === "NOT_FOUND") {
        marker = "absent";
      }
    }

    return {
      ...base,
      marker,
      reason:
        operation.state.reason ??
        "Native markers do not bind a payload; absence may mean in-flight work or expiry. Recovery observes only and never resends",
      status: operation.state.status === "rejected" ? ("rejected" as const) : ("unknown" as const),
    };
  }
  async run<Result>(
    intent: TransactionIntent,
    options: CommitOptions,
    action: (options: CommitOptions) => Promise<Result>
  ): Promise<Result> {
    if (options.dryRun === true) {
      return await action(options);
    }

    const requestId = RequestIdSchema.parse(options.requestId ?? newId());
    const input = IntentSchema.parse(intent);

    if (!(await this.claim(requestId))) {
      const operation = await this.read(requestId);

      if (
        operation.manifest.budgetId !== this.client.budgetId ||
        allocationHash(operation.manifest.intent) !== allocationHash(input)
      ) {
        throw new Error(
          "Transaction request is already bound to a different payload, action, or budget"
        );
      }

      throw new TransactionOperationError(requestId, await this.recover(requestId));
    }

    const body = {
      actor: this.client.session.uid,
      budgetId: this.client.budgetId,
      createdAt: new Date().toISOString(),
      intent: input,
      projectId: "beyond-budget" as const,
      version: 1 as const,
    };

    await saveAllocationFile(nodePath.join(this.path(requestId), "intent.json"), {
      ...body,
      hash: allocationHash(body),
    });
    await this.save(requestId, { status: "planning" });

    try {
      return await action({ ...options, requestId });
    } catch (error) {
      const operation = await this.read(requestId);

      if (operation.state.status === "planning" || operation.state.status === "prepared") {
        await this.save(requestId, {
          reason:
            error instanceof Error ? error.message : "Planning failed before financial dispatch",
          status: "rejected",
        });
      }

      throw error;
    }
  }
  async commit(
    writes: Write[],
    options: CommitOptions,
    snapshot?: FirestoreTransaction
  ): Promise<CommitResult> {
    const preview = await this.client.commit(writes, { ...options, dryRun: true });

    if (!("body" in preview)) {
      throw new Error("Expected a compiled transaction body");
    }

    if (options.dryRun === true) {
      return preview;
    }

    const requestId = RequestIdSchema.parse(options.requestId);
    const operation = await this.operation(requestId);

    if (operation.state.status !== "planning") {
      throw new Error("Only the original transaction sender can dispatch");
    }

    const body =
      snapshot === undefined
        ? preview.body
        : { ...preview.body, transaction: snapshot.transactionId };

    await saveAllocationFile(nodePath.join(this.path(requestId), "submission.json"), {
      body,
      hash: allocationHash(body),
      intentHash: operation.manifest.hash,
    });
    await this.save(requestId, { status: "prepared" });

    try {
      await this.client.document(`${this.client.budgetPath}/saveMarkers/${requestId}`);
      throw new Error("Untracked native marker exists; this operation was not submitted");
    } catch (error) {
      if (!(error instanceof FirestoreError && error.status === "NOT_FOUND")) {
        throw error;
      }
    }

    await this.save(requestId, { status: "sending" });
    let acknowledged: string | undefined;

    try {
      const response =
        snapshot === undefined
          ? await this.client.request(
              `${DocumentRoot}:commit`,
              z.object({ commitTime: z.string() }),
              { body: preview.body, method: "POST" }
            )
          : await snapshot.commit(preview.body.writes);

      acknowledged = response.commitTime;
      await this.save(requestId, { commitTime: acknowledged, status: "committed" });

      return { commitTime: acknowledged, committed: true, requestId, writes: writes.length };
    } catch (error) {
      if (acknowledged !== undefined) {
        return { commitTime: acknowledged, committed: true, requestId, writes: writes.length };
      }

      const diagnostic = new FirestoreCommitError(error, requestId, writes, "unavailable");

      try {
        await this.save(requestId, {
          diagnostic: { ...diagnostic.result, recovery: "observe-only" },
          reason: error instanceof Error ? error.message : "Commit failed",
          status: diagnostic.result.outcome,
        });
      } catch {
        // The durable sending record still forbids replay if outcome persistence fails.
      }

      throw new TransactionOperationError(requestId, await this.recover(requestId));
    }
  }
}
