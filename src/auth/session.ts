/* oxlint-disable unicorn/consistent-function-scoping -- Browser extraction helpers must stay inside their serialized functions. */
/* oxlint-disable promise/avoid-new -- IndexedDB and child processes require Promise adapters for their event callbacks. */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-runtime-typeof -- Serialized browser extraction inspects SDK-owned rows before SessionSchema validates the handoff. */
import { spawn } from "node:child_process";
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import nodePath from "node:path";

import { z } from "zod";

import { dataHome } from "../state.ts";
import type { LoginRuntime } from "./login.ts";

export const ORIGIN = "https://app.beyondbudgetapp.com";

export const SessionSchema = z.object({
  appCheckExpiresAt: z.number().optional(),
  appCheckToken: z.string().optional(),
  budgetIds: z.array(z.string()),
  email: z.string().optional(),
  expiresAt: z.number().finite(),
  idToken: z.string().min(1),
  importedAt: z.string(),
  projectId: z.literal("beyond-budget"),
  selectedBudgetId: z.string().optional(),
  selectedBudgetName: z.string().optional(),
  source: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("agent-browser"), session: z.string() }),
      z.object({ kind: z.literal("browser-profile") }),
      z.object({ kind: z.literal("browser-cdp") }),
    ])
    .optional(),
  stashes: z.array(z.object({ budgetId: z.string(), id: z.string(), type: z.string() })),
  uid: z.string().min(1),
  version: z.literal(1),
});

export type Session = z.infer<typeof SessionSchema>;

interface BrowserSnapshot {
  auth: unknown[];
  checks: unknown[];
  documents: unknown[];
}

const refreshMarginMs = 30_000;
const outputLimit = 2_000_000;
const gcmTagBytes = 16;

export const sessionPath = (): string =>
  process.env.BEBU_SESSION_FILE ?? nodePath.join(dataHome(), "session.json");

// These two functions run as serialized browser code. Keep runtime dependencies inside them.
const readBrowserSnapshot = async (): Promise<BrowserSnapshot> => {
  if (location.origin !== "https://app.beyondbudgetapp.com") {
    throw new Error("Select the signed-in Beyond Budget tab");
  }

  const read = async (name: string, store: string): Promise<unknown[]> => {
    const databasesResult = await indexedDB.databases();

    if (!databasesResult.some((entry) => entry.name === name)) {
      return [];
    }

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(new Error("Cannot open session database")), {
        once: true,
      });
    });

    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const request = database.transaction(store, "readonly").objectStore(store).getAll();
        request.addEventListener("success", () => resolve(request.result), { once: true });
        request.addEventListener("error", () => reject(new Error("Cannot read session database")), {
          once: true,
        });
      });
    } finally {
      database.close();
    }
  };

  return {
    auth: await read("firebaseLocalStorageDb", "firebaseLocalStorage"),
    checks: await read("firebase-app-check-database", "firebase-app-check-store"),
    documents: await read("firestore/[DEFAULT]/beyond-budget/main", "remoteDocumentsV14"),
  };
};

// Browser extraction is untrusted until SessionSchema parses the handoff in this process.
const sessionFromSnapshot = (snapshot: BrowserSnapshot) => {
  // IndexedDB rows vary by Firebase SDK. Inspect unknown fields before schema validation.
  const get = (value: unknown, ...path: string[]): unknown => {
    let current = value;

    for (const key of path) {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        return undefined;
      }

      current = Object.getOwnPropertyDescriptor(current, key)?.value;
    }

    return current;
  };

  const auth = snapshot.auth
    .map((row) => get(row, "value"))
    .find((value) => typeof get(value, "stsTokenManager", "accessToken") === "string");

  if (!auth) {
    throw new Error("The browser has no Firebase session. Sign in to Beyond Budget");
  }

  const check = snapshot.checks
    .map((row) => get(row, "value"))
    .find((value) => {
      const expires = get(value, "expireTimeMillis");

      return (
        typeof get(value, "token") === "string" &&
        typeof expires === "number" &&
        expires > Date.now()
      );
    });

  const budgetIds = new Set<string>();
  const stashes: { budgetId: string; id: string; type: string }[] = [];
  let selectedBudgetId: unknown;

  for (const row of snapshot.documents) {
    const name = get(row, "document", "name");

    if (typeof name !== "string") {
      continue;
    }

    // Serialized browser code cannot capture module constants.
    const budgetId = name.match(/\/documents\/budgets\/(?<budget>[^/]+)/u)?.groups?.budget;

    if (budgetId) {
      budgetIds.add(budgetId);
    }

    const type = get(row, "document", "fields", "type", "stringValue");
    const id = get(row, "documentId");

    if (
      budgetId &&
      name.includes("/stashes/") &&
      typeof type === "string" &&
      typeof id === "string"
    ) {
      stashes.push({ budgetId, id, type });
    }

    if (get(row, "collectionGroup") === "users") {
      selectedBudgetId = get(
        row,
        "document",
        "fields",
        "config",
        "mapValue",
        "fields",
        "selBudgetId",
        "stringValue"
      );
    }
  }

  return {
    appCheckExpiresAt: get(check, "expireTimeMillis"),
    appCheckToken: get(check, "token"),
    budgetIds: [...budgetIds],
    email: get(auth, "email"),
    expiresAt: Number(get(auth, "stsTokenManager", "expirationTime")),
    idToken: get(auth, "stsTokenManager", "accessToken"),
    importedAt: new Date().toISOString(),
    projectId: "beyond-budget",
    selectedBudgetId,
    stashes,
    uid: get(auth, "uid"),
    version: 1,
  };
};

export const browserExpression = (): string =>
  `(async()=>(${sessionFromSnapshot.toString()})(await (${readBrowserSnapshot.toString()})()))()`;

export const saveSession = async (value: Session) => {
  const session = SessionSchema.parse(value);

  if (session.expiresAt <= Date.now()) {
    throw new Error("The session expired. Refresh the app. Then import the session again");
  }

  const path = sessionPath();
  await mkdir(nodePath.dirname(path), { mode: 0o700, recursive: true });
  await writeFile(path, JSON.stringify(session), { mode: 0o600 });

  return {
    budgets: session.budgetIds.length,
    expiresAt: new Date(session.expiresAt).toISOString(),
    imported: true,
    sessionFile: path,
  };
};

export const readAgentBrowser = async (name: string): Promise<Session> => {
  if (!name || name.startsWith("-")) {
    throw new Error("Specify a named agent-browser session");
  }

  const value = await new Promise<unknown>((resolve, reject) => {
    const child = spawn("agent-browser", ["--session", name, "--json", "eval", "--stdin"], {
      shell: false,
      windowsHide: true,
    });

    let output = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("agent-browser session read timed out"));
    }, refreshMarginMs);

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();

      if (output.length > outputLimit) {
        child.kill();
        reject(new Error("Session output too large"));
      }
    });
    child.stderr.resume();
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);

      if (code) {
        reject(new Error("Select the signed-in Beyond Budget tab in that agent-browser session"));

        return;
      }

      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error("Invalid agent-browser response"));
      }
    });
    child.stdin.on("error", () => {
      /* The close and error events handle process errors. */
    });
    child.stdin.end(browserExpression());
  });

  const envelope = z
    .object({ data: z.object({ result: SessionSchema }), success: z.boolean() })
    .parse(value);

  if (!envelope.success) {
    throw new Error("The browser session read failed. Select the app tab with an active login");
  }

  return { ...envelope.data.result, source: { kind: "agent-browser", session: name } };
};

export const loadSession = async (runtime: LoginRuntime = {}): Promise<Session> => {
  let session: Session;

  try {
    session = SessionSchema.parse(JSON.parse(await readFile(sessionPath(), "utf-8")));
  } catch {
    throw new Error("Not signed in. Run bebu auth login");
  }

  const stale =
    session.expiresAt <= Date.now() + refreshMarginMs ||
    (session.appCheckExpiresAt !== undefined &&
      session.appCheckExpiresAt <= Date.now() + refreshMarginMs);

  if (stale && session.source?.kind === "agent-browser") {
    session = await readAgentBrowser(session.source.session);
    await saveSession(session);
  }

  if (stale && session.source?.kind === "browser-profile") {
    const { login } = await import("./login.ts");
    session = await login({ fresh: true, headless: true, timeoutSeconds: 60 }, runtime);
  }

  if (stale && session.source?.kind === "browser-cdp") {
    const { login } = await import("./login.ts");
    session = await login({ timeoutSeconds: 60 }, runtime);
  }

  if (
    session.expiresAt <= Date.now() ||
    (session.appCheckExpiresAt !== undefined && session.appCheckExpiresAt <= Date.now())
  ) {
    throw new Error("Session expired. Run bebu auth login");
  }

  return session;
};

export const prepareSealedImport = async (output?: string) => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "der", type: "spki" },
  });

  const keyPath = `${sessionPath()}.handoff-key`;
  await mkdir(nodePath.dirname(keyPath), { mode: 0o700, recursive: true });
  await writeFile(keyPath, privateKey, { mode: 0o600 });
  const expression = `(async()=>{const session=await ${browserExpression()};const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));const pub=await crypto.subtle.importKey('spki',Uint8Array.from(atob(${JSON.stringify(publicKey.toString("base64"))}),c=>c.charCodeAt(0)),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(session)));const wrapped=await crypto.subtle.encrypt({name:'RSA-OAEP'},pub,await crypto.subtle.exportKey('raw',key));return {encryptedSession:{version:1,key:b64(wrapped),iv:b64(iv),data:b64(data)}}})()`;

  if (!output) {
    return { browserExpression: expression };
  }

  await writeFile(output, expression);

  return {
    next: "Evaluate this script in the signed-in app tab, save the encrypted result, then run session import --sealed <file>",
    script: output,
  };
};

const SealedSchema = z.object({
  data: z.string(),
  iv: z.string(),
  key: z.string(),
  version: z.literal(1),
});

const SealedEnvelopeSchema = z.union([
  z.object({ encryptedSession: SealedSchema }).transform((value) => value.encryptedSession),
  z
    .object({ data: z.object({ result: z.object({ encryptedSession: SealedSchema }) }) })
    .transform((value) => value.data.result.encryptedSession),
  z
    .object({ data: z.object({ encryptedSession: SealedSchema }) })
    .transform((value) => value.data.encryptedSession),
]);

export const importSealed = async (path: string) => {
  const value = SealedEnvelopeSchema.parse(JSON.parse(await readFile(path, "utf-8")));
  const keyPath = `${sessionPath()}.handoff-key`;

  const key = privateDecrypt(
    {
      key: await readFile(keyPath, "utf-8"),
      oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(value.key, "base64")
  );

  const encrypted = Buffer.from(value.data, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(encrypted.subarray(-gcmTagBytes));

  const session = SessionSchema.parse(
    JSON.parse(
      Buffer.concat([
        decipher.update(encrypted.subarray(0, -gcmTagBytes)),
        decipher.final(),
      ]).toString("utf-8")
    )
  );

  const result = await saveSession(session);
  await unlink(keyPath);

  return result;
};

export const PlaywrightStateSchema = z.object({
  origins: z.array(
    z.object({
      indexedDB: z
        .array(
          z.object({
            name: z.string(),
            stores: z.array(
              z.object({ name: z.string(), records: z.array(z.object({ value: z.unknown() })) })
            ),
          })
        )
        .optional(),
      origin: z.string(),
    })
  ),
});

export type PlaywrightState = z.infer<typeof PlaywrightStateSchema>;

export const parsePlaywrightState = (value: PlaywrightState): Session => {
  const origin = PlaywrightStateSchema.parse(value).origins.find(
    (entry) => entry.origin === ORIGIN
  );

  if (!origin?.indexedDB) {
    throw new Error(
      "The state has no Beyond Budget IndexedDB. Save context.storageState({path, indexedDB:true}). Cookies alone do not contain the session"
    );
  }

  const read = (name: string, store: string): unknown[] =>
    origin.indexedDB
      ?.find((database) => database.name === name)
      ?.stores.find((entry) => entry.name === store)
      ?.records.map((row) => row.value) ?? [];

  return SessionSchema.parse(
    sessionFromSnapshot({
      auth: read("firebaseLocalStorageDb", "firebaseLocalStorage"),
      checks: read("firebase-app-check-database", "firebase-app-check-store"),
      documents: read("firestore/[DEFAULT]/beyond-budget/main", "remoteDocumentsV14"),
    })
  );
};
