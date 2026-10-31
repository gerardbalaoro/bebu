/* oxlint-disable no-await-in-loop -- CLI executions share process state and are checked sequentially. */
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { captureExecute } from "@crustjs/testing";
import { z } from "zod";

import { createApp } from "./app.ts";

test("unknown write flags cannot silently become a live commit", async () => {
  const result = await captureExecute(createApp(), [
    "transactions",
    "delete",
    "transactionOne",
    "--dryrun",
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("dryrun");
});

test("account payloads cannot overwrite balances even when the JSON is well formed", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-payload-"));

  try {
    const file = nodePath.join(directory, "patch.json");
    await writeFile(file, '{"balanceAmount":100000}');

    const result = await captureExecute(createApp(), [
      "accounts",
      "update",
      "card",
      "--file",
      file,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(z.strictObject({ error: z.string() }).parse(JSON.parse(result.stderr)).error).toContain(
      "balanceAmount"
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("login rejects credential arguments before opening the browser", async () => {
  const result = await captureExecute(createApp(), [
    "auth",
    "login",
    "test@example.com",
    "fixture-password",
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("fixture-password");
  expect(result.stderr).toContain("auth login --help");
});

test("missing payloads and invalid login timeouts fail with the command's output format", async () => {
  const interactive = await captureExecute(createApp(), ["auth", "login", "--timeout", "0"]);
  expect(interactive.exitCode).toBe(1);
  expect(interactive.stdout).toBe("");
  expect(interactive.stderr).toStartWith("Error: ");
  expect(interactive.stderr).toContain("timeout");
  const structured = await captureExecute(createApp(), ["transactions", "create"]);
  expect(structured.exitCode).toBe(1);
  expect(structured.stdout).toBe("");
  expect(
    z.strictObject({ error: z.string() }).parse(JSON.parse(structured.stderr)).error
  ).toContain("file");
});

test("login parser errors stay readable and never expose credential arguments", async () => {
  const cases = [
    ["auth", "login", "test@example.com", "fixture-password", "--timeout", "not-a-number"],
    ["auth", "login", "test@example.com", "fixture-password", "--bad-flag"],
  ];

  const results = await Promise.all(
    cases.map(async (argv) => await captureExecute(createApp(), argv))
  );

  for (const result of results) {
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toStartWith("Error: ");
    expect(result.stderr).toContain("auth login --help");
    expect(result.stderr).not.toContain("fixture-password");
  }
});

test("auth status and logout return JSON without a format flag", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-auth-output-"));
  const previous = process.env.BEBU_SESSION_FILE;
  process.env.BEBU_SESSION_FILE = nodePath.join(directory, "session.json");

  try {
    const status = await captureExecute(createApp(), ["auth", "status"]);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout)).toEqual({ authenticated: false, state: "signed-out" });
    const logout = await captureExecute(createApp(), ["auth", "logout"]);
    expect(logout.exitCode).toBe(0);
    expect(JSON.parse(logout.stdout)).toEqual({ authenticated: false, loggedOut: true });
  } finally {
    if (previous === undefined) {
      delete process.env.BEBU_SESSION_FILE;
    } else {
      process.env.BEBU_SESSION_FILE = previous;
    }

    await rm(directory, { force: true, recursive: true });
  }
});

test("allocation commands require explicit dry-run and reviewed apply inputs before authentication", async () => {
  for (const args of [
    ["allocations", "set", "category", "--month", "2026-10", "--amount-minor=100"],
    ["allocations", "set", "category", "--month", "2026-10", "--amount-minor=100", "--dryrun"],
    ["allocations", "apply"],
    [
      "allocations",
      "set",
      "category",
      "--month",
      "2026-10",
      "--amount-minor=100",
      "--dry-run",
      "--match-linked",
    ],
  ]) {
    const result = await captureExecute(createApp(), args);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("session expired");
  }
});
