import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

import { spawn } from "bun";
import { z } from "zod";

const entry = fileURLToPath(new URL("../../bin.mjs", import.meta.url));

test("the Node executable runs TypeScript commands through the Oxc loader without Bun", async () => {
  const child = spawn({
    cmd: ["node", entry, "schema", "--compact"],
    stderr: "pipe",
    stdout: "pipe",
  });

  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (code !== 0) {
    throw new Error(`Node entry failed: ${errors}`);
  }

  const result = z
    .object({
      accountUpdate: z.object({ type: z.literal("object") }),
      transactionCreate: z.object({ type: z.literal("object") }),
    })
    .parse(JSON.parse(output));

  expect(result.transactionCreate.type).toBe("object");
  expect(result.accountUpdate.type).toBe("object");
});

test("the linked Node command reads stdin payloads and refuses direct balance writes before auth", async () => {
  const child = spawn({
    cmd: ["node", entry, "accounts", "update", "fixture", "--file", "-"],
    stderr: "pipe",
    stdin: "pipe",
    stdout: "pipe",
  });

  child.stdin.write('{"balanceAmount":100}');
  child.stdin.end();

  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  expect(code).toBe(1);
  expect(output).toBe("");
  expect(errors).toContain("balanceAmount");
  expect(errors).not.toContain("Not signed in");
});

test("an installed copy inside node_modules runs its TypeScript source from another directory", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-installed-"));
  const packageRoot = nodePath.join(directory, "node_modules", "bebu");
  const checkout = fileURLToPath(new URL("../../", import.meta.url));

  try {
    await mkdir(packageRoot, { recursive: true });
    await Promise.all(
      ["bin.mjs", "package.json", "tsconfig.json", "src"].map((name) =>
        cp(nodePath.join(checkout, name), nodePath.join(packageRoot, name), { recursive: true })
      )
    );
    await symlink(
      nodePath.join(checkout, "node_modules"),
      nodePath.join(packageRoot, "node_modules"),
      "junction"
    );

    const child = spawn({
      cmd: ["node", nodePath.join(packageRoot, "bin.mjs"), "schema", "--compact"],
      cwd: directory,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [output, errors, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    if (code !== 0) {
      throw new Error(`Installed entry failed: ${errors}`);
    }

    expect(
      z
        .object({ transactionCreate: z.object({ type: z.literal("object") }) })
        .parse(JSON.parse(output)).transactionCreate.type
    ).toBe("object");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
