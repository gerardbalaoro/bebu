/* oxlint-disable anti-slop/no-unknown-parameters -- Failure callbacks parse caught values at the test boundary. */
/* oxlint-disable complexity -- This HTTP fixture models atomic server behavior across transaction endpoints. */
/* oxlint-disable no-await-in-loop -- Each failure mode gets an isolated operation directory and backend. */
/* oxlint-disable func-style -- Named domain functions follow the repository TypeScript conventions. */
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { z } from "zod";

import { BeyondClient } from "../firestore/client.ts";
import { DataSchema, DocumentRoot, decode, encodeFields } from "../firestore/encoding.ts";
import type { Data } from "../firestore/encoding.ts";
import { allocationHash } from "./allocation-plan.ts";
import { AllocationService } from "./allocation-service.ts";

const root = `${DocumentRoot}/budgets/lab`;
const now = new Date("2026-10-25T00:00:00Z");
const requestId = "abcdefghijklmnopqrst";

function fixture() {
  const documents = new Map<string, { fields: Data; version: string }>();
  let sequence = 0;

  const put = (path: string, value: Data) => {
    sequence += 1;
    documents.set(path, {
      fields: encodeFields(value),
      version: `2026-10-24T00:00:00.${String(sequence).padStart(6, "0")}Z`,
    });
  };

  put(root, {
    availablePeriods: { "2026-10": { id: "october" } },
    id: "lab",
    stashIdentifiers: { ACCOUNTS: "accounts", GROUPS_AND_CATEGORIES: "categories" },
    type: "ZERO_BASED",
  });
  put(`${root}/periods/october`, {
    allocationAmount: 100_000,
    balances: { fund: { allocatedAmount: 0, carriedOverAmount: 1000 } },
    id: "october",
    yearMonth: "2026-10",
  });
  put(`${root}/stashes/fund`, {
    data: { historicalAllocations: {} },
    id: "fund",
    type: "CATEGORY",
  });
  put(`${root}/stashes/accounts`, {
    data: {
      savings: {
        balanceAmount: 5000,
        currencyCode: "",
        id: "savings",
        linkedCategoryId: "fund",
        type: "SAVINGS",
        unclearedBalanceAmount: 0,
      },
    },
  });
  put(`${root}/stashes/categories`, {
    data: {
      categories: {
        fund: {
          accumulationStrategy: "FUND_OVERRUNS",
          groupId: "living",
          id: "fund",
          linkedAccountIds: ["savings"],
        },
      },
      groups: { living: { id: "living" } },
    },
  });
  put(`${DocumentRoot}/users/actor`, { config: { currencyCode: "PHP", timezone: "UTC" } });
  const transactions = new Map<string, Map<string, string | null>>();
  let commits = 0;
  let dropResponse = false;
  let denyMarker = false;
  let omitMarker = false;
  let conflict = false;
  let changedDependency: string | undefined;

  const merge = (before: Data, patch: Data): Data =>
    Object.fromEntries(
      [...new Set([...Object.keys(before), ...Object.keys(patch)])].map((key) => {
        const value = patch[key];
        const nested = z.object({ mapValue: z.object({ fields: DataSchema }) }).safeParse(value);

        const prior = z
          .object({ mapValue: z.object({ fields: DataSchema }) })
          .safeParse(before[key]);

        return [
          key,
          nested.success && prior.success
            ? {
                mapValue: {
                  fields: merge(prior.data.mapValue.fields, nested.data.mapValue.fields),
                },
              }
            : (value ?? before[key]),
        ];
      })
    );

  const respond = (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(z.string().parse(url)).pathname.slice(4);

    const body = DataSchema.parse(
      init?.body === undefined ? {} : JSON.parse(z.string().parse(init.body))
    );

    if (path.endsWith(":beginTransaction")) {
      const id = String(transactions.size + 1);
      transactions.set(id, new Map());

      return Response.json({ transaction: id });
    }

    if (path.endsWith(":rollback")) {
      return Response.json({});
    }

    if (path.endsWith(":batchGet")) {
      const paths = z.array(z.string()).parse(body.documents);

      return Response.json(
        paths.toReversed().map((name) => {
          const document = documents.get(name);
          transactions.get(String(body.transaction))?.set(name, document?.version ?? null);

          return document
            ? { found: { fields: document.fields, name, updateTime: document.version } }
            : { missing: name };
        })
      );
    }

    if (path.endsWith(":commit")) {
      commits += 1;

      if (changedDependency !== undefined) {
        const changed = documents.get(changedDependency);

        if (changed) {
          changed.version = "2026-10-25T00:00:00.999999Z";
        }
      }

      const reads = transactions.get(String(body.transaction));

      if (
        conflict ||
        [...(reads ?? [])].some(
          ([name, version]) => (documents.get(name)?.version ?? null) !== version
        )
      ) {
        return Response.json(
          { error: { message: "Concurrent change", status: "ABORTED" } },
          { status: 409 }
        );
      }

      const writes = z
        .array(
          z.object({
            currentDocument: z.object({
              exists: z.boolean().optional(),
              updateTime: z.string().optional(),
            }),
            update: z.object({ fields: DataSchema, name: z.string() }),
            updateTransforms: z.array(DataSchema).optional(),
          })
        )
        .parse(body.writes);

      for (const write of writes) {
        const previous = documents.get(write.update.name);

        if (
          (write.currentDocument.exists === false && previous) ||
          (write.currentDocument.updateTime !== undefined &&
            previous?.version !== write.currentDocument.updateTime)
        ) {
          return Response.json({ error: { status: "FAILED_PRECONDITION" } }, { status: 400 });
        }
      }

      for (const write of writes) {
        if (omitMarker && write.update.name.includes("/saveMarkers/")) {
          continue;
        }

        sequence += 1;
        documents.set(write.update.name, {
          fields: merge(
            documents.get(write.update.name)?.fields ?? {},
            write.updateTransforms
              ? { ...write.update.fields, createdAt: { timestampValue: now.toISOString() } }
              : write.update.fields
          ),
          version: now.toISOString(),
        });
      }

      if (dropResponse) {
        throw new Error("Connection lost after server acceptance");
      }

      return Response.json({
        commitTime: now.toISOString(),
        writeResults: writes.map(() => ({ updateTime: now.toISOString() })),
      });
    }

    if (denyMarker && path.includes("/saveMarkers/")) {
      return Response.json({ error: { status: "PERMISSION_DENIED" } }, { status: 403 });
    }

    const document = documents.get(path);

    return document
      ? Response.json({ fields: document.fields, name: path, updateTime: document.version })
      : Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 });
  };

  const fetcher = async (url: string | URL | Request, init?: RequestInit) =>
    await Promise.resolve(respond(url, init));

  const client = new BeyondClient(
    {
      budgetIds: ["lab"],
      expiresAt: Date.now() + 3_600_000,
      idToken: "token",
      importedAt: now.toISOString(),
      projectId: "beyond-budget",
      stashes: [],
      uid: "actor",
      version: 1,
    },
    {
      fetcher,
    }
  );

  return {
    absent: () => {
      omitMarker = true;
    },
    changeOnCommit: (path: string) => {
      changedDependency = path;
    },
    client,
    commits: () => commits,
    conflict: () => {
      conflict = true;
    },
    deny: () => {
      denyMarker = true;
    },
    documents,
    drop: () => {
      dropResponse = true;
    },
    fetcher,
    put,
  };
}

async function withService(
  action: (
    service: AllocationService,
    backend: ReturnType<typeof fixture>,
    home: string
  ) => Promise<void>
) {
  const home = await mkdtemp(nodePath.join(tmpdir(), "bebu-allocation-service-"));

  try {
    const backend = fixture();
    await action(new AllocationService(backend.client, { home, now: () => now }), backend, home);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
}

test("preview is financially read-only and apply creates one manual history without changing account money", async () => {
  await withService(async (service, backend) => {
    const accounts = structuredClone(backend.documents.get(`${root}/stashes/accounts`));
    const plan = await service.preview("fund", "2026-10", { amount: -2500 });
    expect(backend.commits()).toBe(0);
    expect(plan.writes).toHaveLength(4);
    const rootWrite = z.object({ update: z.object({ fields: DataSchema }) }).parse(plan.writes[2]);
    const histories = DataSchema.parse(decode(rootWrite.update.fields.allocationHistory));
    expect(histories[plan.historyId]).toEqual({
      accountId: "",
      afterAmount: -2500,
      beforeAmount: 0,
      categoryId: "fund",
      createdAt: plan.createdAt,
      id: plan.historyId,
      linkedCategoryId: "",
      overallocationAmount: 0,
      overallocationStatus: "NONE",
      periodId: "october",
      source: "MANUAL",
      undoneAt: null,
    });
    expect(plan.writes[0]?.updateMask).toEqual({
      fieldPaths: [
        "balances.fund.allocatedAmount",
        "balances.fund.updatedAt",
        "balances.fund.lastUpdateChangeSource",
      ],
    });
    const result = await service.apply(plan, requestId);
    expect(result).toMatchObject({ status: "committed", synchronization: { status: "verified" } });
    expect(backend.commits()).toBe(1);
    expect(backend.documents.get(`${root}/stashes/accounts`)).toEqual(accounts);
    const result1 = await service.apply(plan, requestId);
    expect(result1.status).toBe("committed");
    expect(backend.commits()).toBe(1);
  });
});

test("lost acknowledgment recovers after restart without replaying the commit", async () => {
  await withService(async (service, backend, home) => {
    const plan = await service.preview("fund", "2026-10", { amount: 500 });
    backend.drop();
    const result2 = await service.apply(plan, requestId);
    expect(result2.status).toBe("committed");
    const restarted = new AllocationService(backend.client, { home, now: () => now });
    const result3 = await restarted.recover(requestId);
    expect(result3.status).toBe("committed");
    expect(backend.commits()).toBe(1);
  });
});

test("denied or absent markers preserve unknown outcomes and cannot trigger another attempt", async () => {
  for (const mode of ["deny", "absent"] as const) {
    await withService(async (service, backend, home) => {
      const plan = await service.preview("fund", "2026-10", { amount: 500 });
      backend.drop();
      backend[mode]();
      const result4 = await service.apply(plan, requestId);
      expect(result4.status).toBe("unknown");
      const restarted = new AllocationService(backend.client, { home, now: () => now });
      const result5 = await restarted.apply(plan, requestId);
      expect(result5.status).toBe("unknown");
      expect(backend.commits()).toBe(1);
    });
  }
});

test("stale dependencies and edited write payloads fail before any financial submission", async () => {
  await withService(async (service, backend) => {
    const plan = await service.preview("fund", "2026-10", { amount: 500 });
    backend.put(`${root}/stashes/accounts`, {
      data: {
        savings: {
          balanceAmount: 5000,
          id: "savings",
          linkedCategoryId: "fund",
          notes: "changed",
          type: "SAVINGS",
          unclearedBalanceAmount: 0,
        },
      },
    });
    const result6 = await service.apply(plan, requestId);
    expect(result6.status).toBe("rejected");
    expect(backend.commits()).toBe(0);
  });
  await withService(async (service, backend) => {
    const plan = await service.preview("fund", "2026-10", { amount: 500 });
    plan.writes[0] = { delete: `${root}/stashes/accounts` };
    const { hash: _hash, ...body } = plan;
    plan.hash = allocationHash(body);
    const result7 = await service.apply(plan, requestId);
    expect(result7.status).toBe("rejected");
    expect(backend.commits()).toBe(0);
  });
});

test("reusing a request with changed content is rejected even after a committed operation", async () => {
  await withService(async (service, backend) => {
    const plan = await service.preview("fund", "2026-10", { amount: 500 });
    await service.apply(plan, requestId);
    const other = await service.preview("fund", "2026-10", { amount: 600 });

    const failure = await service
      .apply(other, requestId)
      .catch((error: unknown) => z.object({ message: z.string() }).parse(error));

    expect(z.object({ message: z.string() }).parse(failure).message).toContain("different plan");
    expect(backend.commits()).toBe(1);
  });
});

test("next-month allocations and upcoming bills are preserved while synchronization remains separate from commit", async () => {
  await withService(async (service, backend) => {
    backend.put(root, {
      availablePeriods: { "2026-10": { id: "october" }, "2026-11": { id: "november" } },
      id: "lab",
      stashIdentifiers: { ACCOUNTS: "accounts", GROUPS_AND_CATEGORIES: "categories" },
      type: "ZERO_BASED",
    });
    backend.put(`${root}/periods/november`, {
      allocationCarriedOverAmount: 100_000,
      balances: { fund: { allocatedAmount: 1000, carriedOverAmount: 1000, upcomingAmount: 250 } },
      id: "november",
      yearMonth: "2026-11",
    });
    const plan = await service.preview("fund", "2026-10", { amount: 500 });
    const applied = await service.apply(plan, requestId);
    expect(applied).toMatchObject({ status: "committed", synchronization: { status: "pending" } });
    expect(backend.commits()).toBe(1);
    backend.put(`${root}/periods/november`, {
      allocationCarriedOverAmount: 99_500,
      balances: { fund: { allocatedAmount: 1000, carriedOverAmount: 1500, upcomingAmount: 250 } },
      id: "november",
      yearMonth: "2026-11",
    });
    const recovered = await service.recover(requestId);
    expect(recovered).toMatchObject({
      status: "committed",
      synchronization: { status: "verified" },
    });
    expect(backend.commits()).toBe(1);
  });
});

test("unchanged plans produce no history and definite conflicts are never replayed", async () => {
  await withService(async (service, backend) => {
    const plan = await service.preview("fund", "2026-10", { amount: 0 });
    const result = await service.apply(plan, requestId);
    expect(result.status).toBe("no-change");
    expect(backend.commits()).toBe(0);
  });
  await withService(async (service, backend) => {
    const plan = await service.preview("fund", "2026-10", { amount: 500 });
    backend.conflict();
    const result = await service.apply(plan, requestId);
    expect(result.status).toBe("rejected");
    const repeated = await service.apply(plan, requestId);
    expect(repeated.status).toBe("rejected");
    expect(backend.commits()).toBe(1);
  });
});

test("every planning dependency participates in the commit transaction's read set", async () => {
  const dependencies = [
    root,
    `${root}/periods/october`,
    `${root}/stashes/fund`,
    `${root}/stashes/accounts`,
    `${root}/stashes/categories`,
    `${DocumentRoot}/users/actor`,
  ];

  await Promise.all(
    dependencies.map(async (dependency) => {
      await withService(async (service, backend) => {
        const plan = await service.preview("fund", "2026-10", { amount: 500 });
        backend.changeOnCommit(dependency);
        const result = await service.apply(plan, requestId);
        expect(result.status).toBe("rejected");
        expect(backend.commits()).toBe(1);
        expect(backend.documents.has(`${root}/saveMarkers/${plan.markerId}`)).toBe(false);
      });
    })
  );
});

test("a process exit after persisting sending is recovered without creating another sender", async () => {
  await withService(async (service, backend, home) => {
    const plan = await service.preview("fund", "2026-10", { amount: 500 });
    const file = nodePath.join(home, "reviewed-plan.json");
    await writeFile(file, JSON.stringify(plan), { mode: 0o600 });
    const module = new URL("allocation-operations.ts", import.meta.url).href;

    const script = `import {readFile} from 'node:fs/promises';
      import {AllocationOperations} from ${JSON.stringify(module)};
      const store = new AllocationOperations('actor','lab',${JSON.stringify(home)});
      if (!(await store.claim(${JSON.stringify(requestId)}))) process.exit(2);
      const plan = JSON.parse(await readFile(${JSON.stringify(file)},'utf8'));
      await store.prepare(${JSON.stringify(requestId)},plan);
      await store.save(${JSON.stringify(requestId)},{status:'sending'});
      process.exit(42);`;

    const child = spawnSync(process.execPath, ["--eval", script], {
      encoding: "utf-8",
      timeout: 10_000,
    });

    expect(child.status).toBe(42);
    const restarted = new AllocationService(backend.client, { home, now: () => now });
    const recovered = await restarted.recover(requestId);
    expect(recovered.status).toBe("unknown");
    const repeated = await restarted.apply(plan, requestId);
    expect(repeated.status).toBe("unknown");
    expect(backend.commits()).toBe(0);
  });
});

test("the matching intent compiles and commits the cleared-account result without account writes", async () => {
  await withService(async (service, backend) => {
    const account = structuredClone(backend.documents.get(`${root}/stashes/accounts`));
    const plan = await service.preview("fund", "2026-10", { matchLinked: true });
    expect(plan.summary.after).toEqual({ allocation: 4000, available: 5000, pool: 96_000 });
    const result = await service.apply(plan, requestId);
    expect(result.status).toBe("committed");
    expect(backend.documents.get(`${root}/stashes/accounts`)).toEqual(account);
    expect(backend.commits()).toBe(1);
  });
});

test("inconsistent category history is rejected instead of silently repairing an unrelated discrepancy", async () => {
  await withService(async (service, backend) => {
    backend.put(`${root}/stashes/fund`, {
      data: { historicalAllocations: { "2026-10": 100 } },
      id: "fund",
      type: "CATEGORY",
    });

    const failure = await service
      .preview("fund", "2026-10", { amount: 500 })
      .catch((error: unknown) => z.object({ message: z.string() }).parse(error));

    expect(z.object({ message: z.string() }).parse(failure).message).toContain("history disagree");
    expect(backend.commits()).toBe(0);
  });
});
