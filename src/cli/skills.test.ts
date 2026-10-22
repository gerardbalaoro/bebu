import { expect, test } from "bun:test";
import { lstat, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { captureExecute } from "@crustjs/testing";
import { z } from "zod";

import { createApp } from "./app.ts";

test("source generation produces a complete installable skill without a build directory", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-skills-"));
  const previousDirectory = process.cwd();

  try {
    process.chdir(directory);
    const result = await captureExecute(createApp(), ["skills", "generate"]);
    expect(result.exitCode).toBe(0);
    const generated = z.object({ files: z.array(z.string()) }).parse(JSON.parse(result.stdout));
    expect(generated.files.length).toBeGreaterThan(0);

    const generatedFiles = await Promise.all(
      generated.files.map((file) => stat(nodePath.join(directory, "skills", file)))
    );

    for (const file of generatedFiles) {
      expect(file.isFile()).toBe(true);
    }

    const installed = await captureExecute(createApp(), ["skills", "install"]);
    expect(installed.exitCode).toBe(0);

    const statResult1 = await stat(
      nodePath.join(directory, ".agents", "skills", "bebu", "SKILL.md")
    );

    expect(statResult1.isFile()).toBe(true);

    const metadata = await stat(
      nodePath.join(directory, ".agents", "skills", "bebu", "agents", "openai.yaml")
    );

    expect(metadata.isFile()).toBe(true);
    const lstatResult = await lstat(nodePath.join(directory, ".agents", "skills", "bebu"));
    expect(lstatResult.isSymbolicLink()).toBe(false);
  } finally {
    process.chdir(previousDirectory);
    await rm(directory, { force: true, recursive: true });
  }
});
