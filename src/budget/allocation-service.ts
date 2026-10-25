import { z } from "zod";

import type { BeyondClient } from "../firestore/client.ts";
import { FirestoreError } from "../firestore/client.ts";
import { FirestoreTransaction } from "../firestore/transaction.ts";
import { AllocationOperations } from "./allocation-operations.ts";
import type { AllocationState } from "./allocation-operations.ts";
import {
  buildAllocationPlan,
  compileManualAllocation,
  previewManualAllocation,
  readManualSnapshot,
  validateAllocationPlan,
} from "./allocation-plan.ts";
import type { AllocationPlan } from "./allocation-plan.ts";
import { observeAllocation } from "./allocation-synchronization.ts";
import type { AllocationIntent } from "./manual-allocation.ts";

const RejectionStatuses = new Set([
  "ABORTED",
  "FAILED_PRECONDITION",
  "ALREADY_EXISTS",
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "RESOURCE_EXHAUSTED",
  "OUT_OF_RANGE",
]);

export class AllocationService {
  private readonly operations: AllocationOperations;
  private readonly now: () => Date;

  private readonly client: BeyondClient;

  constructor(client: BeyondClient, options: { home?: string; now?: () => Date } = {}) {
    this.client = client;
    this.operations = new AllocationOperations(client.session.uid, client.budgetId, options.home);
    this.now = options.now ?? (() => new Date());
  }

  async preview(categoryId: string, month: string, intent: AllocationIntent) {
    return await previewManualAllocation(this.client, categoryId, month, intent, this.now());
  }

  private identity(plan: AllocationPlan) {
    if (
      plan.actor !== this.client.session.uid ||
      plan.budgetId !== this.client.budgetId ||
      plan.projectId !== this.client.session.projectId
    ) {
      throw new Error("Allocation plan belongs to another actor, project, or budget");
    }
  }

  async operation(requestId: string) {
    const operation = await this.operations.read(requestId);
    this.identity(operation.plan);

    return { ...operation, requestId };
  }

  private async result(requestId: string, plan: AllocationPlan, state: AllocationState) {
    return {
      ...state,
      planHash: plan.hash,
      recoveryScope: "same-installation-local-manifest",
      requestId,
      summary: plan.summary,
      synchronization:
        state.status === "committed" ? await observeAllocation(this.client, plan) : undefined,
    };
  }

  async recover(requestId: string) {
    const { plan, state } = await this.operation(requestId);

    if (
      state.status === "committed" ||
      state.status === "rejected" ||
      state.status === "no-change"
    ) {
      return await this.result(requestId, plan, state);
    }

    if (state.status === "prepared") {
      return await this.result(requestId, plan, {
        reason:
          "Preparation exists; the original sender may still be running. No financial retry was made",
        status: "unknown",
      });
    }

    try {
      const marker = await this.client.document(
        `${this.client.budgetPath}/saveMarkers/${plan.markerId}`,
        z.object({
          createdAt: z.iso.datetime({ offset: true }),
          expireAt: z.iso.datetime({ offset: true }),
        })
      );

      const expectedExpiry = new Date(Date.parse(plan.createdAt) + 30 * 86_400_000).toISOString();

      if (Date.parse(marker.data.expireAt) !== Date.parse(expectedExpiry)) {
        return await this.result(requestId, plan, {
          reason: "Marker expiry does not match the immutable local operation",
          status: "unknown",
        });
      }

      return {
        ...(await this.result(requestId, plan, { status: "committed" })),
        markerCreatedAt: marker.data.createdAt,
        recovered: true,
      };
    } catch (error) {
      let reason = error instanceof Error ? error.message : "Marker recovery failed";

      if (error instanceof FirestoreError && error.status === "NOT_FOUND") {
        reason =
          "Marker is absent; an in-flight or expired operation remains uncertain. No financial retry was made";
      }

      return await this.result(requestId, plan, { reason, status: "unknown" });
    }
  }

  async apply(input: AllocationPlan, requestId: string) {
    const plan = validateAllocationPlan(input);
    this.identity(plan);

    if (!(await this.operations.claim(requestId))) {
      const operation = await this.operation(requestId);

      if (operation.plan.hash !== plan.hash) {
        throw new Error("Allocation request is already bound to a different plan");
      }

      return await this.recover(requestId);
    }

    await this.operations.prepare(requestId, plan);
    let transaction: FirestoreTransaction | undefined;
    let submitted = false;
    let acknowledged: string | undefined;

    try {
      const age = this.now().getTime() - Date.parse(plan.createdAt);

      if (age < 0 || age > 15 * 60_000) {
        throw new Error("Allocation plan is stale; create a new reviewed plan");
      }

      transaction = await FirestoreTransaction.begin(this.client, "write");

      const snapshot = await readManualSnapshot(
        this.client,
        transaction,
        plan.month,
        plan.categoryId,
        this.now()
      );

      const fresh = buildAllocationPlan(this.client, snapshot, plan.categoryId, plan.intent, plan);

      if (fresh.hash !== plan.hash) {
        throw new Error("Allocation plan is stale or its compiled content changed");
      }

      const { summary, writes } = compileManualAllocation(
        snapshot,
        plan.categoryId,
        plan.intent,
        plan
      );

      if (summary.noChange) {
        const state = { status: "no-change" } as const;
        await this.operations.save(requestId, state);

        return await this.result(requestId, plan, state);
      }

      const markerPath = `${this.client.budgetPath}/saveMarkers/${plan.markerId}`;

      const markers = await transaction.read([markerPath]);

      if (markers.get(markerPath)) {
        throw new Error("Untracked marker already exists; this new operation was not submitted");
      }

      await this.operations.save(requestId, { status: "sending" });
      submitted = true;
      const response = await transaction.commit(writes);

      if (response.writeResults.length !== writes.length) {
        throw new Error("Incomplete allocation commit acknowledgment");
      }

      acknowledged = response.commitTime;
      const state = { commitTime: acknowledged, status: "committed" } as const;
      await this.operations.save(requestId, state);

      return await this.result(requestId, plan, state);
    } catch (error) {
      if (acknowledged !== undefined) {
        return await this.result(requestId, plan, {
          commitTime: acknowledged,
          reason:
            "Commit acknowledged; local result persistence failed. The sending record remains recoverable",
          status: "committed",
        });
      }

      const rejected =
        !submitted || (error instanceof FirestoreError && RejectionStatuses.has(error.status));

      const state: AllocationState = {
        reason: error instanceof Error ? error.message : "Allocation failed",
        status: rejected ? "rejected" : "unknown",
      };

      await this.operations.save(requestId, state);

      return rejected ? await this.result(requestId, plan, state) : await this.recover(requestId);
    } finally {
      if (transaction) {
        try {
          await transaction.rollback();
        } catch {
          // A rollback failure cannot change the already recorded financial outcome.
        }
      }
    }
  }
}
