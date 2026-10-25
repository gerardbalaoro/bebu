/* oxlint-disable anti-slop/no-unknown-parameters -- Failure callbacks parse caught values at the test boundary. */
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { AllocationOperations } from "./allocation-operations.ts";

const requestId = "abcdefghijklmnopqrst";

test("exclusive request claims survive restart and never create a second sender", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bebu-operations-"));

  try {
    const operations = new AllocationOperations("actor", "budget", directory);
    const claims = await Promise.all([operations.claim(requestId), operations.claim(requestId)]);
    expect(claims.toSorted((a, b) => Number(a) - Number(b))).toEqual([false, true]);
    const restarted = new AllocationOperations("actor", "budget", directory);
    expect(await restarted.claim(requestId)).toBe(false);
    expect(await restarted.exists(requestId)).toBe(true);

    const failure = await restarted
      .read(requestId)
      .catch((error: unknown) => z.object({ message: z.string() }).parse(error));

    expect(z.object({ message: z.string() }).parse(failure).message).toContain("incomplete");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("operation identifiers cannot escape the private storage namespace", async () => {
  const operations = new AllocationOperations("actor", "budget", "/unused");

  const failure = await operations
    .claim("../../another-user")
    .catch((error: unknown) => z.object({ message: z.string() }).parse(error));

  expect(z.object({ message: z.string() }).parse(failure).message).toContain("request");
});
