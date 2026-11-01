/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-runtime-typeof -- The synthetic wire interpreter validates nested fields while preserving mutable references. */
/* oxlint-disable complexity, func-style, require-await, no-await-in-loop -- The synthetic Firestore boundary applies ordered atomic commits to real wire payloads. */
import { expect, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { captureExecute } from "@crustjs/testing";
import { z } from "zod";

import { createApp } from "../cli/app.ts";
import type { Fetcher } from "../firestore/client.ts";
import { BeyondClient } from "../firestore/client.ts";
import { DataSchema, DocumentRoot, decode, encodeFields } from "../firestore/encoding.ts";
import type { Data, Write } from "../firestore/encoding.ts";
import { ReallocationService } from "./reallocation.ts";

const Root = `${DocumentRoot}/budgets/reallocationLab`;
const Version = "2026-11-01T00:00:00.123456Z";
const Runtime = Intl.DateTimeFormat().resolvedOptions().timeZone;

const input = {
  amountMinor: 25,
  calculationTimezone: Runtime,
  from: "source",
  month: "2099-12",
  to: "destination",
};

const category = (id: string) => ({
  carryOverStrategy: "ALL",
  groupId: "needs",
  id,
  linkedAccountIds: [],
  modifiable: true,
  transactionCount: 0,
  type: "DEFAULT",
  unknown: "preserve",
});

const makeStash = (id: string, type: string, extra = {}) => ({
  data: { completedTransactionCount: 0, completedTransactions: {}, trimmed: false, ...extra },
  id,
  type,
});

function segments(field: string) {
  return [...field.matchAll(/`(?<quoted>[^`]+)`|(?<plain>[^.]+)/gu)].map((match) =>
    z.string().parse(match.groups?.quoted ?? match.groups?.plain)
  );
}

function get(record: Data, keys: string[]): unknown {
  let value: unknown = record;

  for (const key of keys) {
    value = DataSchema.parse(value)[key];
  }

  return value;
}

function set(record: Data, keys: string[], value: unknown) {
  const [first, ...remaining] = keys;
  const key = z.string().parse(first);

  if (remaining.length === 0) {
    record[key] = value;

    return;
  }

  const child = DataSchema.parse(record[key] ?? {});
  set(child, remaining, value);
  record[key] = child;
}

function fixture() {
  const source = {
    allocatedAmount: 70,
    carriedOverAmount: 40,
    otherAmount: 0,
    spentAmount: 10,
    upcomingAmount: 5,
  };

  const destination = {
    allocatedAmount: 10,
    carriedOverAmount: 0,
    otherAmount: 2,
    spentAmount: 30,
    upcomingAmount: 0,
  };

  const docs = new Map<string, Data>([
    [
      Root,
      {
        allocationHistory: {},
        availablePeriods: { "2099-12": { id: "period" } },
        id: "reallocationLab",
        stashIdentifiers: {
          ACCOUNTS: "accounts",
          GROUPS_AND_CATEGORIES: "categories",
          TRANSACTIONS: "global",
        },
        type: "ZERO_BASED",
        unknownRoot: "preserve",
      },
    ],
    [
      `${DocumentRoot}/users/actor`,
      { config: { timezone: Runtime }, displayName: "Synthetic", photoUrl: "" },
    ],
    [
      `${Root}/stashes/categories`,
      {
        data: {
          categories: { destination: category("destination"), source: category("source") },
          groups: { needs: { id: "needs", modifiable: true, type: "DEFAULT" } },
        },
      },
    ],
    [
      `${Root}/stashes/accounts`,
      { data: { cash: { balanceAmount: 1000, id: "cash", linkedCategoryId: null } } },
    ],
    [
      `${Root}/periods/period`,
      {
        allocationAmount: 1000,
        allocationCarriedOverAmount: 500,
        balances: { destination, source },
        id: "period",
        yearMonth: "2099-12",
      },
    ],
    [`${Root}/stashes/global`, makeStash("global", "TRANSACTIONS")],
    [`${Root}/stashes/period`, makeStash("period", "PERIOD")],
    [
      `${Root}/stashes/source`,
      makeStash("source", "CATEGORY", { historicalAllocations: { "2099-12": 70 } }),
    ],
    [
      `${Root}/stashes/destination`,
      makeStash("destination", "CATEGORY", { historicalAllocations: { "2099-12": 10 } }),
    ],
  ]);

  const bodies: Data[] = [];
  const reads: Data[] = [];
  let stalePath: string | undefined;
  const captured = new Map<string, string>();
  let reject = false;
  let lost = false;
  let collision = false;
  let commits = 0;

  const fetcher: Fetcher = async (url, init) => {
    const path = new URL(new Request(url).url).pathname.slice(4);

    const body =
      init?.body !== undefined && init.body !== null
        ? DataSchema.parse(JSON.parse(z.string().parse(init.body)))
        : {};

    if (path.endsWith(":beginTransaction")) {
      return Response.json({ transaction: "snapshot" });
    }

    if (path.endsWith(":rollback")) {
      return Response.json({});
    }

    if (path.endsWith(":batchGet")) {
      reads.push(body);

      return Response.json(
        z
          .array(z.string())
          .parse(body.documents)
          .map((name) => {
            const data = docs.get(name);
            captured.set(name, JSON.stringify(data));

            if (collision && name.includes("/transactions/")) {
              return {
                found: {
                  fields: encodeFields({ id: name.split("/").at(-1) }),
                  name,
                  updateTime: Version,
                },
              };
            }

            return data
              ? { found: { fields: encodeFields(data), name, updateTime: Version } }
              : { missing: name };
          })
      );
    }

    if (path.endsWith(":commit")) {
      commits += 1;
      bodies.push(body);

      if (stalePath !== undefined) {
        docs.set(stalePath, { ...docs.get(stalePath), concurrent: true });
      }

      const stale = [...captured].some(([name, value]) => JSON.stringify(docs.get(name)) !== value);

      if (reject || stale) {
        return Response.json(
          { error: { message: "stale dependency", status: "ABORTED" } },
          { status: 409 }
        );
      }

      for (const entry of z.array(z.custom<Write>()).parse(body.writes)) {
        const name = z.string().parse(entry.update?.name);
        const record = structuredClone(docs.get(name) ?? {});

        const fields = Object.fromEntries(
          Object.entries(entry.update?.fields ?? {}).map(([key, value]) => [key, decode(value)])
        );

        if (entry.updateMask) {
          for (const field of entry.updateMask.fieldPaths) {
            set(record, segments(field), get(fields, segments(field)));
          }
        } else {
          Object.assign(record, fields);
        }

        for (const transform of entry.updateTransforms ?? []) {
          const keys = segments(transform.fieldPath);
          set(
            record,
            keys,
            "increment" in transform
              ? z.number().parse(get(record, keys)) + Number(transform.increment.integerValue)
              : "2099-12-01T00:00:00Z"
          );
        }

        docs.set(name, record);
      }

      if (lost) {
        throw new Error("acknowledgment lost after atomic application");
      }

      return Response.json({
        commitTime: "2099-12-01T00:00:00Z",
        writeResults: z
          .array(z.unknown())
          .parse(body.writes)
          .map(() => ({})),
      });
    }

    const data = docs.get(path);

    return data
      ? Response.json({ fields: encodeFields(data), name: path, updateTime: Version })
      : Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 });
  };

  const client = new BeyondClient(
    {
      budgetIds: ["reallocationLab"],
      expiresAt: Date.now() + 3_600_000,
      idToken: "synthetic",
      importedAt: Version,
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
    bodies,
    client,
    collide: () => {
      collision = true;
    },
    commits: () => commits,
    docs,
    fail: () => {
      reject = true;
    },
    fetcher,
    lose: () => {
      lost = true;
    },
    reads,
    stale: (path: string) => {
      stalePath = path;
    },
  };
}

async function withService(
  action: (data: ReturnType<typeof fixture>, service: ReallocationService) => Promise<void>
) {
  const home = await mkdtemp(nodePath.join(tmpdir(), "bebu-reallocation-"));
  const data = fixture();

  try {
    await action(data, new ReallocationService(data.client, { home }));
  } finally {
    await rm(home, { force: true, recursive: true });
  }
}

test("reallocation compiles the native full write set in a read-only snapshot without dispatch", async () => {
  await withService(async (data, service) => {
    const before = structuredClone(data.docs);
    const result = await service.reallocate(input, { dryRun: true });
    assert.ok("body" in result);
    expect(data.commits()).toBe(0);
    expect(data.docs).toEqual(before);
    expect(result.body.writes).toHaveLength(9);
    expect(result.summary).toMatchObject({
      destination: {
        allocatedAfter: 35,
        allocatedBefore: 10,
        availableAfter: 7,
        availableBefore: -18,
      },
      history: { afterAmount: 25, beforeAmount: 70, source: "MONEY_REALLOCATION" },
      persistence: "atomic-transaction-and-history",
      source: { allocatedAfter: 45, allocatedBefore: 70, availableAfter: 75, availableBefore: 100 },
    });

    const canonical = result.body.writes.find(
      (write) => write.update?.name.includes("/transactions/") === true
    );

    const fields = canonical?.update?.fields;
    expect(fields?.createdAt).toHaveProperty("timestampValue");
    expect(fields?.dueAt).toHaveProperty("timestampValue");
    expect(result.summary.transaction).toMatchObject({
      amount: -25,
      autoAllocateIfCapable: true,
      completed: true,
      editable: false,
      timezone: Runtime,
      version: 1,
      yearMonth: "2099-12",
    });
    expect(new Date(result.summary.transaction.dueAt).getDate()).toBe(31);
    expect(data.reads.every((body) => body.transaction === "snapshot")).toBe(true);

    for (const write of result.body.writes.filter(
      (entry) => entry.update?.name.includes("/stashes/") === true
    )) {
      const transforms = write.updateTransforms ?? [];

      if (write.update?.name !== `${Root}/stashes/categories`) {
        expect(transforms).toContainEqual({
          fieldPath: "data.completedTransactionCount",
          increment: { integerValue: "1" },
        });

        const [raw] = Object.values(
          DataSchema.parse(
            DataSchema.parse(
              DataSchema.parse(decode(write.update?.fields?.data)).completedTransactions
            )
          )
        );

        expect(raw).toMatchObject({
          amount: -25,
          completed: true,
          integrityCount: 1,
          type: "REALLOCATE_MONEY",
        });
        expect(raw).not.toHaveProperty("seriesAmount");
        expect(raw).not.toHaveProperty("anchorDay");
      }
    }
  });
});

test("one acknowledged reallocation atomically saves money, history, all four counts and preserves unrelated fields", async () => {
  await withService(async (data, service) => {
    const before = structuredClone(data.docs);
    const result = await service.reallocate(input, { requestId: "ReallocateTest000001" });
    expect(result).toMatchObject({ committed: true });
    expect(data.bodies).toHaveLength(1);
    expect(data.bodies[0]?.transaction).toBe("snapshot");
    expect(
      get(DataSchema.parse(data.docs.get(`${Root}/periods/period`)), ["balances", "source"])
    ).toEqual({
      allocatedAmount: 45,
      carriedOverAmount: 40,
      otherAmount: 0,
      spentAmount: 10,
      upcomingAmount: 5,
    });
    expect(data.docs.get(`${Root}/stashes/accounts`)).toEqual(
      before.get(`${Root}/stashes/accounts`)
    );
    expect(data.docs.get(Root)?.unknownRoot).toBe("preserve");
    const root = DataSchema.parse(data.docs.get(Root));
    expect(DataSchema.parse(root.allocationHistory)[result.transactionId]).toMatchObject({
      accountId: "",
      afterAmount: 25,
      beforeAmount: 70,
      linkedCategoryId: "destination",
      overallocationAmount: 0,
      overallocationStatus: "NONE",
    });

    for (const id of ["global", "period", "source", "destination"]) {
      const stash = DataSchema.parse(data.docs.get(`${Root}/stashes/${id}`));
      expect(get(stash, ["data", "completedTransactionCount"])).toBe(1);
      expect(
        get(stash, ["data", "completedTransactions", result.transactionId, "integrityCount"])
      ).toBe(1);
    }

    expect(
      get(DataSchema.parse(data.docs.get(`${Root}/stashes/source`)), [
        "data",
        "historicalAllocations",
        "2099-12",
      ])
    ).toBe(45);
    expect(
      get(DataSchema.parse(data.docs.get(`${Root}/stashes/destination`)), [
        "data",
        "historicalAllocations",
        "2099-12",
      ])
    ).toBe(35);
    await assert.rejects(
      service.reallocate(input, { requestId: "ReallocateTest000001" }),
      /No financial retry/u
    );
    await assert.rejects(
      service.reallocate({ ...input, amountMinor: 26 }, { requestId: "ReallocateTest000001" }),
      /different/u
    );
    expect(data.commits()).toBe(1);
  });
});

test("native failures reject the whole atomic envelope and lost acknowledgments never replay either logical component", async () => {
  for (const lost of [false, true]) {
    await withService(async (data, service) => {
      const before = structuredClone(data.docs);

      if (lost) {
        data.lose();
      } else {
        data.fail();
      }

      await assert.rejects(
        service.reallocate(input, { requestId: "ReallocateTest000002" }),
        /No financial retry/u
      );

      if (lost) {
        expect(data.docs.get(Root)?.allocationHistory).not.toEqual({});
      } else {
        expect(data.docs).toEqual(before);
      }

      await assert.rejects(
        service.reallocate(input, { requestId: "ReallocateTest000002" }),
        /No financial retry/u
      );
      expect(data.commits()).toBe(1);
    });
  }
});

test("unknown amounts, links, history, hierarchy and incomplete index evidence stop before financial dispatch", async () => {
  const changes: ((docs: Map<string, Data>) => void)[] = [
    (docs) => {
      const period = DataSchema.parse(docs.get(`${Root}/periods/period`));
      const balances = z.record(z.string(), DataSchema).parse(period.balances);
      delete balances.source?.otherAmount;
      docs.set(`${Root}/periods/period`, { ...period, balances });
    },
    (docs) => {
      const root = DataSchema.parse(docs.get(Root));
      root.availablePeriods = { "2099-12": { id: "period" }, "2100-01": { id: "later" } };
      docs.set(Root, root);
    },
    (docs) => {
      const stash = DataSchema.parse(docs.get(`${Root}/stashes/source`));
      stash.data = { ...DataSchema.parse(stash.data), historicalAllocations: {} };
      docs.set(`${Root}/stashes/source`, stash);
    },
    (docs) => {
      const stash = DataSchema.parse(docs.get(`${Root}/stashes/global`));
      stash.data = { ...DataSchema.parse(stash.data), trimmed: true };
      docs.set(`${Root}/stashes/global`, stash);
    },
    (docs) => {
      const stash = DataSchema.parse(docs.get(`${Root}/stashes/period`));
      stash.data = { ...DataSchema.parse(stash.data), completedTransactionCount: 1 };
      docs.set(`${Root}/stashes/period`, stash);
    },
    ...[
      { linkedAccountIds: undefined },
      { parentCategoryId: "destination" },
      { target: null },
      { transactionCount: null },
      { carryOverStrategy: undefined },
    ].map((patch) => (docs: Map<string, Data>) => {
      const stash = DataSchema.parse(docs.get(`${Root}/stashes/categories`));
      const structure = DataSchema.parse(stash.data);
      const cats = z.record(z.string(), DataSchema).parse(structure.categories);
      cats.source = { ...cats.source, ...patch };
      docs.set(`${Root}/stashes/categories`, {
        ...stash,
        data: { ...structure, categories: cats },
      });
    }),
  ];

  for (const change of changes) {
    await withService(async (data, service) => {
      change(data.docs);
      await assert.rejects(service.reallocate(input, { dryRun: true }));
      expect(data.commits()).toBe(0);
    });
  }

  await withService(async (data, service) => {
    data.collide();
    await assert.rejects(service.reallocate(input, { dryRun: true }), /identity already exists/u);
    expect(data.commits()).toBe(0);
  });
});

test("zero, negative, overflow, same category, insufficient funds and mismatched runtime timezone are rejected", async () => {
  for (const patch of [
    { amountMinor: 0 },
    { amountMinor: -1 },
    { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
    { to: "source" },
    { amountMinor: 101 },
    { calculationTimezone: Runtime === "UTC" ? "Asia/Manila" : "UTC" },
  ]) {
    await withService(async (data, service) => {
      await assert.rejects(service.reallocate({ ...input, ...patch }, { dryRun: true }));
      expect(data.commits()).toBe(0);
    });
  }
});

test("stale root, user, account, category, period and preview dependencies reject all financial writes", async () => {
  for (const path of [
    Root,
    `${DocumentRoot}/users/actor`,
    `${Root}/stashes/accounts`,
    `${Root}/stashes/categories`,
    `${Root}/periods/period`,
    `${Root}/stashes/global`,
    `${Root}/stashes/period`,
    `${Root}/stashes/source`,
    `${Root}/stashes/destination`,
  ]) {
    await withService(async (data, service) => {
      const before = structuredClone(data.docs);
      data.stale(path);
      await assert.rejects(
        service.reallocate(input, { requestId: "ReallocateTest000003" }),
        /ABORTED/u
      );

      for (const [name, original] of before) {
        expect(data.docs.get(name)).toEqual(
          name === path ? { ...original, concurrent: true } : original
        );
      }

      expect(data.docs.size).toBe(before.size);
      expect(data.commits()).toBe(1);
    });
  }
});

test("CLI reallocation flags reach the real planner and dry run omits writes unless full is requested", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-reallocation-cli-"));
  const previousSession = process.env.BEBU_SESSION_FILE;
  const data = fixture();

  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(data.fetcher, { preconnect: fetch.preconnect })
  );

  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    await writeFile(process.env.BEBU_SESSION_FILE, JSON.stringify(data.client.session));

    const args = [
      "allocations",
      "reallocate",
      "--budget",
      "reallocationLab",
      "--from",
      "source",
      "--to",
      "destination",
      "--amount-minor",
      "25",
      "--month",
      "2099-12",
      "--calculation-timezone",
      Runtime,
      "--dry-run",
      "--compact",
    ];

    const full = await captureExecute(createApp(), [...args, "--full"]);
    expect(full.exitCode).toBe(0);
    expect(JSON.parse(full.stdout)).toMatchObject({
      dryRun: true,
      executionSupported: true,
      summary: {
        amountMinor: 25,
        destination: { allocatedAfter: 35 },
        source: { allocatedAfter: 45 },
      },
    });
    expect(
      z.object({ body: z.object({ writes: z.array(DataSchema) }) }).parse(JSON.parse(full.stdout))
        .body.writes
    ).toHaveLength(9);
    const compact = await captureExecute(createApp(), args);
    expect(compact.exitCode).toBe(0);
    expect(JSON.parse(compact.stdout)).not.toHaveProperty("body");
    expect(data.commits()).toBe(0);
  } finally {
    fetchMock.mockRestore();

    if (previousSession === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previousSession;
    }

    await rm(directory, { force: true, recursive: true });
  }
});

test("resulting amount and category counter overflow reject before commit", async () => {
  for (const kind of ["destination", "availability", "counter"]) {
    await withService(async (data, service) => {
      if (kind === "counter") {
        const doc = DataSchema.parse(data.docs.get(`${Root}/stashes/categories`));
        set(doc, ["data", "categories", "source", "transactionCount"], Number.MAX_SAFE_INTEGER);
        data.docs.set(`${Root}/stashes/categories`, doc);
      } else {
        const doc = DataSchema.parse(data.docs.get(`${Root}/periods/period`));
        const categoryId = kind === "destination" ? "destination" : "source";
        set(doc, ["balances", categoryId, "allocatedAmount"], Number.MAX_SAFE_INTEGER);
        data.docs.set(`${Root}/periods/period`, doc);
      }

      await assert.rejects(service.reallocate(input, { dryRun: true }));
      expect(data.commits()).toBe(0);
    });
  }
});
