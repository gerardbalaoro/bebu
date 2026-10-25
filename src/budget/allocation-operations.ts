/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- These schema and canonical JSON boundaries validate untrusted Firestore or saved-plan values. */
/* oxlint-disable func-style -- Named domain functions follow the repository TypeScript conventions. */
import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import nodePath from "node:path";

import { z } from "zod";

import { newId } from "../firestore/encoding.ts";
import { dataHome } from "../state.ts";
import { AllocationPlanSchema, allocationHash, validateAllocationPlan } from "./allocation-plan.ts";
import type { AllocationPlan } from "./allocation-plan.ts";

const RequestIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{20}$/u, "request-id must contain exactly 20 letters or digits");

export const AllocationStateSchema = z.strictObject({
  commitTime: z.string().optional(),
  reason: z.string().optional(),
  status: z.enum(["prepared", "sending", "committed", "rejected", "unknown", "no-change"]),
});

export type AllocationState = z.infer<typeof AllocationStateSchema>;

async function syncDirectory(path: string) {
  const directory = await open(path, "r");

  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function saveAllocationFile(path: string, value: unknown) {
  const temporary = `${path}.${newId()}.tmp`;
  const file = await open(temporary, "wx", 0o600);

  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }

  await rename(temporary, path);
  await syncDirectory(nodePath.dirname(path));
}

// A permanent exclusive directory is both the request tombstone and the single-sender claim.
// It is never unlocked or pruned. Recovery only observes; it cannot take over and send again.
export class AllocationOperations {
  private readonly directory: string;

  constructor(actor: string, budget: string, home = dataHome()) {
    this.directory = nodePath.join(
      home,
      "allocation-operations",
      allocationHash({ actor, budget, database: "(default)", project: "beyond-budget" })
    );
  }

  private path(requestId: string) {
    return nodePath.join(this.directory, RequestIdSchema.parse(requestId));
  }

  async exists(requestId: string) {
    try {
      await stat(this.path(requestId));

      return true;
    } catch (error) {
      const result = z.object({ code: z.string() }).safeParse(error);

      if (result.success && result.data.code === "ENOENT") {
        return false;
      }

      throw error;
    }
  }

  async claim(requestId: string) {
    const path = this.path(requestId);
    await mkdir(this.directory, { mode: 0o700, recursive: true });

    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      const result = z.object({ code: z.string() }).safeParse(error);

      if (result.success && result.data.code === "EEXIST") {
        return false;
      }

      throw error;
    }

    let parent = this.directory;

    for (;;) {
      // Synchronize new ancestor entries before a request can become a financial sender.
      // oxlint-disable-next-line no-await-in-loop -- Directory durability proceeds from child to parent.
      await syncDirectory(parent);
      const next = nodePath.dirname(parent);

      if (next === parent) {
        break;
      }

      parent = next;
    }

    return true;
  }

  async prepare(requestId: string, plan: AllocationPlan) {
    await saveAllocationFile(
      nodePath.join(this.path(requestId), "plan.json"),
      AllocationPlanSchema.parse(plan)
    );
    await this.save(requestId, { status: "prepared" });
  }

  async save(requestId: string, state: AllocationState) {
    await saveAllocationFile(
      nodePath.join(this.path(requestId), "state.json"),
      AllocationStateSchema.parse(state)
    );
  }

  async read(requestId: string) {
    try {
      const path = this.path(requestId);

      const plan = validateAllocationPlan(
        JSON.parse(await readFile(nodePath.join(path, "plan.json"), "utf-8"))
      );

      const state = AllocationStateSchema.parse(
        JSON.parse(await readFile(nodePath.join(path, "state.json"), "utf-8"))
      );

      return { plan, state };
    } catch {
      throw new Error(
        "Allocation operation is missing, incomplete, or corrupt; the request must not be submitted again"
      );
    }
  }
}
