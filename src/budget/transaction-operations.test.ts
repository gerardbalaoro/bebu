/* oxlint-disable require-await, no-await-in-loop -- Synthetic fetch boundaries return immediate responses; retry attempts must run sequentially. */
/* oxlint-disable func-style -- Named fixtures keep durable-operation boundaries explicit. */
import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { BeyondClient } from "../firestore/client.ts";
import type { Fetcher } from "../firestore/client.ts";
import { DocumentRoot, encodeFields } from "../firestore/encoding.ts";
import { TransactionOperations } from "./transaction-operations.ts";

const requestId = "RecoveryRequest00001";
const intent = { action: "update" as const, input: { notes: "reviewed" }, transactionId: "record" };

function client(fetcher: Fetcher, budget = "budget") {
  return new BeyondClient(
    {
      budgetIds: [budget],
      expiresAt: Date.now() + 60_000,
      idToken: "synthetic",
      importedAt: "2026-10-01T00:00:00.000Z",
      projectId: "beyond-budget",
      stashes: [],
      uid: "actor",
      version: 1,
    },
    { budget, fetcher }
  );
}

const writes = [
  {
    currentDocument: { updateTime: "2026-10-01T00:00:00.000Z" },
    update: {
      fields: encodeFields({ notes: "reviewed" }),
      name: `${DocumentRoot}/budgets/budget/transactions/record`,
    },
  },
];

test("request reuse with a changed payload, budget, or action never dispatches again", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "bebu-transaction-operations-"));
  let commits = 0;

  const fetcher: Fetcher = async (_url, init) => {
    if (init?.method === "POST") {
      commits += 1;

      return Response.json({ commitTime: "2026-10-02T00:00:00.000Z" });
    }

    return Response.json({ error: { message: "absent", status: "NOT_FOUND" } }, { status: 404 });
  };

  try {
    const operations = new TransactionOperations(client(fetcher), { home });
    await operations.run(
      intent,
      { requestId },
      async (options) => await operations.commit(writes, options)
    );
    expect(commits).toBe(1);

    for (const changed of [
      { ...intent, input: { notes: "different" } },
      { ...intent, action: "delete" as const },
    ]) {
      await assert.rejects(
        operations.run(
          changed,
          { requestId },
          async (options) => await operations.commit(writes, options)
        ),
        /different/u
      );
    }

    const otherBudget = new TransactionOperations(client(fetcher, "other"), { home });
    await assert.rejects(
      otherBudget.run(
        intent,
        { requestId },
        async (options) => await otherBudget.commit(writes, options)
      ),
      /different/u
    );
    expect(commits).toBe(1);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("durable rejection preserves the native conflict code separately from local operation status", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "bebu-transaction-conflict-"));
  let commits = 0;

  const fetcher: Fetcher = async (_url, init) => {
    if (init?.method === "POST") {
      commits += 1;

      return Response.json(
        { error: { message: "concurrent change", status: "ABORTED" } },
        { status: 409 }
      );
    }

    return Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 });
  };

  try {
    const operations = new TransactionOperations(client(fetcher), { home });
    await assert.rejects(
      operations.run(
        intent,
        { requestId },
        async (options) => await operations.commit(writes, options)
      ),
      /ABORTED/u
    );
    const observation = await operations.recover(requestId);
    expect(observation).toMatchObject({
      commitDiagnostic: { conflict: true, httpStatus: 409, outcome: "rejected", status: "ABORTED" },
      financialRetryMade: false,
      status: "rejected",
    });
    expect(commits).toBe(1);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("lost responses preserve the exact body and recovery only observes even with a matching native marker", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "bebu-transaction-operations-"));
  let commits = 0;
  let marker = false;

  const fetcher: Fetcher = async (url, init) => {
    if (init?.method === "POST") {
      commits += 1;
      marker = true;
      throw new Error("response lost");
    }

    if (new Request(url).url.includes("saveMarkers") && marker) {
      return Response.json({
        fields: encodeFields({
          createdAt: "2026-10-02T00:00:00.000Z",
          expireAt: "2026-10-31T00:00:00.000Z",
        }),
        name: new Request(url).url.replace("https://firestore.googleapis.com/v1/", ""),
        updateTime: "2026-10-02T00:00:00.000Z",
      });
    }

    return Response.json({ error: { message: "absent", status: "NOT_FOUND" } }, { status: 404 });
  };

  try {
    const operations = new TransactionOperations(client(fetcher), { home });
    await assert.rejects(
      operations.run(
        intent,
        { requestId },
        async (options) => await operations.commit(writes, options)
      ),
      /recovery/u
    );
    const restarted = new TransactionOperations(client(fetcher), { home });
    const operation = await restarted.operation(requestId);
    expect(operation.submission?.body.writes.slice(0, -1)).toEqual(writes);
    expect(operation.submission?.hash).toMatch(/^[a-f0-9]{64}$/u);
    const recovered = await restarted.recover(requestId);
    expect(recovered.status).toBe("unknown");
    await assert.rejects(
      restarted.run(
        intent,
        { requestId },
        async (options) => await restarted.commit(writes, options)
      ),
      /recovery/u
    );
    expect(commits).toBe(1);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("compiled body is durable and marked sending before the first financial dispatch", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "bebu-transaction-durable-"));
  let inspected = false;

  const fetcher: Fetcher = async (_url, init) => {
    if (init?.method !== "POST") {
      return Response.json({ error: { message: "absent", status: "NOT_FOUND" } }, { status: 404 });
    }

    // oxlint-disable-next-line no-use-before-define -- Fetch runs after the operation fixture has been constructed.
    const operation = await operations.operation(requestId);
    expect(operation.state.status).toBe("sending");
    const dispatched = await new Request("https://example.test", init).text();
    expect(JSON.stringify(operation.submission?.body)).toBe(dispatched);
    inspected = true;

    return Response.json({ commitTime: "2026-10-02T00:00:00.000Z" });
  };

  const operations = new TransactionOperations(client(fetcher), { home });

  try {
    await operations.run(
      intent,
      { requestId },
      async (options) => await operations.commit(writes, options)
    );
    expect(inspected).toBe(true);
    const recovered = await operations.recover(requestId);
    expect(recovered).toMatchObject({
      commitTime: "2026-10-02T00:00:00.000Z",
      financialRetryMade: false,
      status: "committed",
    });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("a preexisting unbound native marker prevents dispatch instead of claiming payload success", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "bebu-transaction-marker-"));
  let commits = 0;

  const fetcher: Fetcher = async (url, init) => {
    if (init?.method === "POST") {
      commits += 1;
    }

    return Response.json({
      fields: encodeFields({ createdAt: "2026-10-02T00:00:00.000Z" }),
      name: new Request(url).url.replace("https://firestore.googleapis.com/v1/", ""),
      updateTime: "2026-10-02T00:00:00.000Z",
    });
  };

  const operations = new TransactionOperations(client(fetcher), { home });

  try {
    await assert.rejects(
      operations.run(
        intent,
        { requestId },
        async (options) => await operations.commit(writes, options)
      ),
      /Untracked native marker/u
    );
    const observation = await operations.recover(requestId);
    expect(observation).toMatchObject({
      financialRetryMade: false,
      marker: "present",
      status: "rejected",
    });
    expect(commits).toBe(0);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("dry runs reserve no operation and concurrent live claims create at most one sender", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "bebu-transaction-exclusive-"));
  let commits = 0;

  const fetcher: Fetcher = async (_url, init) => {
    if (init?.method === "POST") {
      commits += 1;

      return Response.json({ commitTime: "2026-10-02T00:00:00.000Z" });
    }

    return Response.json({ error: { message: "absent", status: "NOT_FOUND" } }, { status: 404 });
  };

  try {
    const operations = new TransactionOperations(client(fetcher), { home });
    await operations.run(
      intent,
      { dryRun: true, requestId },
      async (options) => await operations.commit(writes, options)
    );
    await assert.rejects(operations.operation(requestId), /missing/u);

    const attempts = await Promise.allSettled([
      operations.run(
        intent,
        { requestId },
        async (options) => await operations.commit(writes, options)
      ),
      operations.run(
        intent,
        { requestId },
        async (options) => await operations.commit(writes, options)
      ),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(commits).toBe(1);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("corrupt or incomplete permanent records block reusing a request after restart", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "bebu-transaction-corrupt-"));
  let commits = 0;

  const fetcher: Fetcher = async (_url, init) => {
    if (init?.method === "POST") {
      commits += 1;

      return Response.json({ commitTime: "2026-10-02T00:00:00.000Z" });
    }

    return Response.json({ error: { message: "absent", status: "NOT_FOUND" } }, { status: 404 });
  };

  try {
    const operations = new TransactionOperations(client(fetcher), { home });
    await operations.run(
      intent,
      { requestId },
      async (options) => await operations.commit(writes, options)
    );
    const [owner] = await readdir(path.join(home, "transaction-operations"));

    if (owner === undefined) {
      throw new Error("Expected an operation owner directory");
    }

    const directory = path.join(home, "transaction-operations", owner, requestId);
    const submissionFile = path.join(directory, "submission.json");
    const fileStatus = await stat(submissionFile);
    const directoryStatus = await stat(directory);
    expect(fileStatus.mode.toString(8).slice(-3)).toBe("600");
    expect(directoryStatus.mode.toString(8).slice(-3)).toBe("700");
    const original = await readFile(submissionFile, "utf-8");
    await writeFile(submissionFile, original.replace("reviewed", "tampered"));
    const restarted = new TransactionOperations(client(fetcher), { home });
    await assert.rejects(
      restarted.run(
        intent,
        { requestId },
        async (options) => await restarted.commit(writes, options)
      ),
      /corrupt/u
    );
    await writeFile(submissionFile, original);
    await rm(path.join(directory, "state.json"));
    await assert.rejects(
      restarted.run(
        intent,
        { requestId },
        async (options) => await restarted.commit(writes, options)
      ),
      /incomplete/u
    );
    expect(commits).toBe(1);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("recovery bounds document observations and never infers success from unchanged versions and a marker", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "bebu-transaction-observe-"));
  let dispatched = false;
  let commits = 0;

  const fetcher: Fetcher = async (url, init) => {
    if (init?.method === "POST") {
      commits += 1;
      dispatched = true;
      throw new Error("response lost");
    }

    if (!dispatched) {
      return Response.json({ error: { message: "absent", status: "NOT_FOUND" } }, { status: 404 });
    }

    return Response.json({
      fields: encodeFields({ createdAt: "2026-10-02T00:00:00.000Z" }),
      name: new Request(url).url.replace("https://firestore.googleapis.com/v1/", ""),
      updateTime: "2026-10-01T00:00:00.000Z",
    });
  };

  try {
    const operations = new TransactionOperations(client(fetcher), { home });
    const [sample] = writes;
    assert.ok(sample);

    const multiple = Array.from({ length: 60 }, (_, index) => ({
      ...sample,
      update: {
        ...sample.update,
        name: `${DocumentRoot}/budgets/budget/transactions/record${index}`,
      },
    }));

    await assert.rejects(
      operations.run(
        intent,
        { requestId },
        async (options) => await operations.commit(multiple, options)
      ),
      /recovery/u
    );
    const recovered = await operations.recover(requestId);
    expect(recovered.status).toBe("unknown");
    expect(recovered.marker).toBe("present");
    expect(recovered.observation).toMatchObject({
      documentLimit: 50,
      establishesCommitOutcome: false,
      remainingWriteObservations: 10,
      snapshotConsistent: false,
    });
    expect(recovered.observation.documents).toHaveLength(50);
    expect(recovered.observation.documents[0]).toMatchObject({
      exists: true,
      originalPreconditionMatches: true,
      updateTime: "2026-10-01T00:00:00.000Z",
    });
    expect(commits).toBe(1);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});
