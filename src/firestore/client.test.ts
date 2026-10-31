import { expect, test } from "bun:test";
import assert from "node:assert/strict";

import { z } from "zod";

import type { Session } from "../auth/session.ts";
import { BeyondClient } from "./client.ts";
import { DataSchema } from "./encoding.ts";
import type { Write } from "./encoding.ts";

const root = "projects/beyond-budget/databases/(default)/documents";
const budgetPath = `${root}/budgets/testBudget`;
const requestId = "abcdefghijklmnopqrst";
const timestamp = "2026-10-01T00:00:00.000Z";

const session: Session = {
  appCheckToken: "test-app-check",
  budgetIds: ["testBudget"],
  expiresAt: Date.now() + 3_600_000,
  idToken: "test-token",
  importedAt: timestamp,
  projectId: "beyond-budget",
  stashes: [],
  uid: "testUser",
  version: 1,
};

const writes: Write[] = [
  {
    currentDocument: { updateTime: timestamp },
    update: { fields: { pinned: { booleanValue: true } }, name: `${budgetPath}/stashes/accounts` },
    updateMask: { fieldPaths: ["pinned"] },
  },
];

test("a lost commit response is resolved by its atomic marker without replaying the writes", async () => {
  const requests: {
    url: string;
    method: string;
    authorization: string | null;
    appCheck: string | null;
  }[] = [];

  let body: unknown;

  const client = new BeyondClient(session, {
    fetcher: async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        appCheck: headers.get("X-Firebase-AppCheck"),
        authorization: headers.get("Authorization"),
        method: init?.method ?? "GET",
        url: new Request(input).url,
      });

      if (init?.method === "POST") {
        body = JSON.parse(await new Request(input, init).text());

        throw new Error("Connection lost after write");
      }

      return await Promise.resolve(
        Response.json({
          fields: { createdAt: { timestampValue: timestamp } },
          name: `${budgetPath}/saveMarkers/${requestId}`,
          updateTime: timestamp,
        })
      );
    },
  });

  expect(await client.commit(writes, { requestId })).toEqual({
    alreadyCommitted: true,
    commitTime: timestamp,
    committed: true,
    requestId,
  });
  expect(requests).toEqual([
    {
      appCheck: "test-app-check",
      authorization: "Bearer test-token",
      method: "POST",
      url: `https://firestore.googleapis.com/v1/${root}:commit`,
    },
    {
      appCheck: "test-app-check",
      authorization: "Bearer test-token",
      method: "GET",
      url: `https://firestore.googleapis.com/v1/${budgetPath}/saveMarkers/${requestId}`,
    },
  ]);
  const emitted = z.object({ writes: z.array(DataSchema) }).parse(body);
  expect(emitted.writes).toHaveLength(2);
  expect(emitted.writes[0]).toEqual({
    currentDocument: { updateTime: timestamp },
    update: { fields: { pinned: { booleanValue: true } }, name: `${budgetPath}/stashes/accounts` },
    updateMask: { fieldPaths: ["pinned"] },
  });
  expect(emitted.writes[1]).toMatchObject({
    currentDocument: { exists: false },
    update: { name: `${budgetPath}/saveMarkers/${requestId}` },
    updateTransforms: [{ fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" }],
  });
});

test("a snapshot conflict with no saved marker remains a failure and is not retried", async () => {
  const methods: string[] = [];

  const client = new BeyondClient(session, {
    fetcher: async (_input, init) => {
      methods.push(init?.method ?? "GET");

      return await Promise.resolve(
        init?.method === "POST"
          ? Response.json(
              { error: { message: "Document changed", status: "FAILED_PRECONDITION" } },
              { status: 409 }
            )
          : Response.json({ error: { message: "No marker", status: "NOT_FOUND" } }, { status: 404 })
      );
    },
  });

  await assert.rejects(client.commit(writes, { requestId }), /FAILED_PRECONDITION/u);
  expect(methods).toEqual(["POST", "GET"]);
});

test("a write outside the selected budget is rejected before any network request", async () => {
  let requests = 0;

  const client = new BeyondClient(session, {
    fetcher: () => {
      requests += 1;

      throw new Error("Unexpected request");
    },
  });

  await assert.rejects(
    client.commit([{ delete: `${root}/budgets/anotherBudget/transactions/one` }]),
    /outside the selected budget/u
  );
  expect(requests).toBe(0);
});

test("a rejected version conflict carries its request ID and refresh instructions without replay", async () => {
  const methods: string[] = [];

  const client = new BeyondClient(session, {
    fetcher: async (_input, init) => {
      methods.push(init?.method ?? "GET");

      return await Promise.resolve(
        init?.method === "POST"
          ? Response.json(
              {
                error: {
                  message: "the stored version does not match the required base version",
                  status: "FAILED_PRECONDITION",
                },
              },
              { status: 400 }
            )
          : Response.json({ error: { message: "No marker", status: "NOT_FOUND" } }, { status: 404 })
      );
    },
  });

  await assert.rejects(client.commit(writes, { requestId }), (error) => {
    expect(error).toMatchObject({
      result: {
        conflict: true,
        httpStatus: 400,
        marker: "absent",
        outcome: "rejected",
        preconditions: [{ document: `${budgetPath}/stashes/accounts`, updateTime: timestamp }],
        recovery: "refresh-preview",
        requestId,
        status: "FAILED_PRECONDITION",
      },
    });

    return true;
  });
  expect(methods).toEqual(["POST", "GET"]);
});

test.each([
  { outcome: "rejected", status: "FAILED_PRECONDITION" },
  { outcome: "unknown", status: "INTERNAL" },
])(
  "a $status failure with an unreadable marker requires inspection before retry",
  async ({ outcome, status }) => {
    let commits = 0;

    const client = new BeyondClient(session, {
      fetcher: async (_input, init) => {
        if (init?.method === "POST") {
          commits += 1;

          return await Promise.resolve(
            Response.json(
              { error: { message: "Commit failed", status } },
              { status: status === "INTERNAL" ? 500 : 400 }
            )
          );
        }

        return await Promise.resolve(
          Response.json(
            { error: { message: "Denied", status: "PERMISSION_DENIED" } },
            { status: 403 }
          )
        );
      },
    });

    await assert.rejects(client.commit(writes, { requestId }), (error) => {
      expect(error).toMatchObject({
        result: {
          marker: "unavailable",
          outcome,
          recovery: "inspect-before-retry",
          requestId,
          status,
        },
      });

      return true;
    });
    expect(commits).toBe(1);
  }
);

test.each(["missing", "unavailable"])(
  "a lost commit with a %s marker remains unknown and is never replayed",
  async (marker) => {
    let commits = 0;

    const client = new BeyondClient(session, {
      fetcher: async (_input, init) => {
        if (init?.method === "POST") {
          commits += 1;
          throw new Error("Lost response");
        }

        return await Promise.resolve(
          Response.json(
            {
              error: {
                message: "Marker unreadable",
                status: marker === "missing" ? "NOT_FOUND" : "PERMISSION_DENIED",
              },
            },
            { status: marker === "missing" ? 404 : 403 }
          )
        );
      },
    });

    await assert.rejects(client.commit(writes), (error) => {
      expect(error).toMatchObject({
        result: {
          conflict: false,
          marker: marker === "missing" ? "absent" : "unavailable",
          outcome: "unknown",
          recovery: "inspect-before-retry",
        },
      });

      const failure = z
        .object({ result: z.object({ requestId: z.string().regex(/^[A-Za-z0-9]{20}$/u) }) })
        .parse(error);

      expect(failure.result.requestId).toHaveLength(20);

      return true;
    });
    expect(commits).toBe(1);
  }
);
