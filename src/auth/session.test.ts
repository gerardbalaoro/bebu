import { expect, test } from "bun:test";
/* oxlint-disable promise/avoid-new -- The IndexedDB fixture completes through event callbacks. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { runInNewContext } from "node:vm";

import { IDBFactory } from "fake-indexeddb";

import { importSealed, loadSession, parsePlaywrightState, prepareSealedImport } from "./session.ts";

const expiresAt = Date.now() + 3_600_000;

const authRow = {
  fbase_key: "firebase:authUser:fixture:[DEFAULT]",
  value: {
    displayName: "Test User",
    email: "test@example.com",
    stsTokenManager: {
      accessToken: "dummy-browser-token",
      expirationTime: expiresAt,
      refreshToken: "not-exported",
    },
    uid: "test-user",
  },
};

const appCheckRow = {
  compositeKey: "fixture:[DEFAULT]",
  value: { expireTimeMillis: expiresAt, token: "dummy-app-check" },
};

const cacheRows = [
  {
    document: {
      fields: { type: { stringValue: "ACCOUNTS" } },
      name: "projects/beyond-budget/databases/(default)/documents/budgets/budgetOne/stashes/accountsIndex",
    },
    documentId: "accountsIndex",
  },
  {
    collectionGroup: "users",
    document: {
      fields: { config: { mapValue: { fields: { selBudgetId: { stringValue: "budgetOne" } } } } },
      name: "projects/beyond-budget/databases/(default)/documents/users/test-user",
    },
  },
];

test("Playwright IndexedDB state supplies auth, App Check, budget selection, and cached index identifiers", () => {
  const session = parsePlaywrightState({
    origins: [
      {
        indexedDB: [
          {
            name: "firebaseLocalStorageDb",
            stores: [{ name: "firebaseLocalStorage", records: [{ value: authRow }] }],
          },
          {
            name: "firebase-app-check-database",
            stores: [{ name: "firebase-app-check-store", records: [{ value: appCheckRow }] }],
          },
          {
            name: "firestore/[DEFAULT]/beyond-budget/main",
            stores: [
              { name: "remoteDocumentsV14", records: cacheRows.map((value) => ({ value })) },
            ],
          },
        ],
        origin: "https://app.beyondbudgetapp.com",
      },
    ],
  });

  expect(session).toMatchObject({
    appCheckToken: "dummy-app-check",
    budgetIds: ["budgetOne"],
    displayName: "Test User",
    email: "test@example.com",
    expiresAt,
    idToken: "dummy-browser-token",
    selectedBudgetId: "budgetOne",
    stashes: [{ budgetId: "budgetOne", id: "accountsIndex", type: "ACCOUNTS" }],
    uid: "test-user",
  });
  expect(JSON.stringify(session)).not.toContain("not-exported");
  expect(() => parsePlaywrightState({ origins: [] })).toThrow("IndexedDB");
});

const seedDatabase = async (
  factory: IDBFactory,
  name: string,
  store: string,
  rows: unknown[]
): Promise<void> => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name);
    request.addEventListener(
      "upgradeneeded",
      () => {
        const objectStore = request.result.createObjectStore(store, { autoIncrement: true });

        for (const row of rows) {
          objectStore.add(row);
        }
      },
      { once: true }
    );
    request.addEventListener(
      "success",
      () => {
        resolve(request.result);
      },
      { once: true }
    );
    request.addEventListener(
      "error",
      () => {
        reject(request.error ?? new Error("Fixture database could not open"));
      },
      { once: true }
    );
  });

  database.close();
};

test("the serialized browser handoff runs without module closures and decrypts only in the local CLI", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-session-"));
  const previousPath = process.env.BEBU_SESSION_FILE;
  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    const indexedDB = new IDBFactory();
    await seedDatabase(indexedDB, "firebaseLocalStorageDb", "firebaseLocalStorage", [authRow]);
    await seedDatabase(indexedDB, "firebase-app-check-database", "firebase-app-check-store", [
      appCheckRow,
    ]);
    await seedDatabase(
      indexedDB,
      "firestore/[DEFAULT]/beyond-budget/main",
      "remoteDocumentsV14",
      cacheRows
    );
    const prepared = await prepareSealedImport();

    if (prepared.browserExpression === undefined || prepared.browserExpression === "") {
      throw new Error("Missing handoff expression");
    }

    const envelope: unknown = await runInNewContext(prepared.browserExpression, {
      TextEncoder,
      atob,
      btoa,
      crypto,
      indexedDB,
      location: { origin: "https://app.beyondbudgetapp.com" },
    });

    const encrypted = JSON.stringify(envelope);
    expect(encrypted).not.toContain("dummy-browser-token");
    const path = nodePath.join(directory, "handoff.json");
    await writeFile(path, encrypted);
    expect(await importSealed(path)).toMatchObject({ budgets: 1, imported: true });
    expect(await loadSession()).toMatchObject({
      appCheckToken: "dummy-app-check",
      displayName: "Test User",
      email: "test@example.com",
      idToken: "dummy-browser-token",
      selectedBudgetId: "budgetOne",
    });
    expect(await readFile(nodePath.join(directory, "session.json"), "utf-8")).not.toContain(
      "not-exported"
    );
    await assert.rejects(stat(nodePath.join(directory, "session.json.handoff-key")));
  } finally {
    if (previousPath === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previousPath;
    }

    await rm(directory, { force: true, recursive: true });
  }
});
