/* oxlint-disable anti-slop/no-unknown-parameters -- Failure callbacks parse caught values at the test boundary. */
/* oxlint-disable no-await-in-loop -- Each malformed stream is tested independently. */
import { expect, test } from "bun:test";

import { z } from "zod";

import { BeyondClient, FirestoreError } from "./client.ts";
import { DataSchema, DocumentRoot, encodeFields } from "./encoding.ts";
import { FirestoreTransaction } from "./transaction.ts";

const session = {
  appCheckToken: "app-check",
  budgetIds: ["lab"],
  expiresAt: Date.now() + 3_600_000,
  idToken: "token",
  importedAt: "2026-10-25T00:00:00Z",
  projectId: "beyond-budget" as const,
  stashes: [],
  uid: "actor",
  version: 1 as const,
};

const path = `${DocumentRoot}/budgets/lab`;
const version = "2026-10-25T00:00:00.123456Z";

test("transactional reads match unordered responses by name and preserve microsecond versions", async () => {
  const requests: unknown[] = [];

  const client = new BeyondClient(session, {
    fetcher: async (_url, init) => {
      expect(new Headers(init?.headers).get("X-Firebase-AppCheck")).toBe("app-check");
      const body = DataSchema.parse(JSON.parse(z.string().parse(init?.body)));
      requests.push(body);

      return await Promise.resolve(
        Response.json(
          requests.length === 1
            ? { transaction: "transaction" }
            : [
                { missing: `${path}/stashes/missing` },
                { found: { fields: encodeFields({ id: "lab" }), name: path, updateTime: version } },
              ]
        )
      );
    },
  });

  const transaction = await FirestoreTransaction.begin(client, "write");
  const documents = await transaction.read([path, `${path}/stashes/missing`]);
  expect(documents.get(path)?.updateTime).toBe(version);
  expect(documents.get(path)?.data).toEqual({ id: "lab" });
  expect(documents.has(`${path}/stashes/missing`)).toBe(true);
  expect(documents.get(`${path}/stashes/missing`)).toBeNull();
  expect(requests).toEqual([
    { options: { readWrite: { concurrencyMode: "OPTIMISTIC" } } },
    { documents: [path, `${path}/stashes/missing`], transaction: "transaction" },
  ]);
});

test("incomplete and duplicate transaction reads cannot become usable snapshots", async () => {
  for (const rows of [[], [{ missing: path }, { missing: path }], [{ missing: `${path}/other` }]]) {
    let calls = 0;

    const client = new BeyondClient(session, {
      fetcher: async () => {
        calls += 1;

        return await Promise.resolve(
          Response.json(calls === 1 ? { transaction: "transaction" } : rows)
        );
      },
    });

    const transaction = await FirestoreTransaction.begin(client, "read");

    const failure = await transaction
      .read([path])
      .catch((error: unknown) => z.object({ message: z.string() }).parse(error));

    expect(z.object({ message: z.string() }).parse(failure).message).toContain(
      "transaction response"
    );
  }
});

test("canonical Firestore failures preserve status instead of becoming marker absence", async () => {
  const client = new BeyondClient(session, {
    fetcher: async () =>
      await Promise.resolve(
        Response.json(
          { error: { message: "Denied", status: "PERMISSION_DENIED" } },
          { status: 403 }
        )
      ),
  });

  try {
    await FirestoreTransaction.begin(client, "write");
    throw new Error("Expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(FirestoreError);
    expect(error).toMatchObject({ httpStatus: 403, status: "PERMISSION_DENIED" });
  }
});

test("transaction root support cannot replace the budget or edit unrelated root fields", async () => {
  let requests = 0;

  const client = new BeyondClient(session, {
    fetcher: async () => {
      requests += 1;

      return await Promise.resolve(Response.json({ transaction: "transaction" }));
    },
  });

  const transaction = await FirestoreTransaction.begin(client, "write");

  const failure = await transaction
    .commit([{ update: { fields: { name: { stringValue: "replaced" } }, name: path } }])
    .catch((error: unknown) => z.object({ message: z.string() }).parse(error));

  expect(z.object({ message: z.string() }).parse(failure).message).toContain("currentDocument");
  expect(requests).toBe(1);
});
